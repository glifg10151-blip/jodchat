use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use ring::digest::{Context as DigestContext, SHA256};
use serde::de::{SeqAccess, Visitor};
use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::AppError;

fn convert_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }
    let mut mono = Vec::with_capacity(samples.len() / channels as usize);
    for chunk in samples.chunks_exact(channels as usize) {
        let sum: f32 = chunk.iter().sum();
        mono.push(sum / channels as f32);
    }
    mono
}

fn resample(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = source_rate as f64 / target_rate as f64;
    let new_length = (samples.len() as f64 / ratio).round() as usize;
    let mut result = Vec::with_capacity(new_length);
    for i in 0..new_length {
        let orig_idx = i as f64 * ratio;
        let index_below = orig_idx.floor() as usize;
        let index_above = orig_idx.ceil() as usize;
        let weight = orig_idx - index_below as f64;
        let val_below = samples[index_below];
        let val_above = if index_above < samples.len() {
            samples[index_above]
        } else {
            val_below
        };
        result.push(val_below + weight as f32 * (val_above - val_below));
    }
    result
}

#[derive(Default)]
struct RecordedAudio {
    session_id: Option<String>,
    sample_rate: u32,
    samples: Vec<f32>,
}

static RECORDED_AUDIO: LazyLock<Arc<Mutex<RecordedAudio>>> =
    LazyLock::new(|| Arc::new(Mutex::new(RecordedAudio::default())));
const WHISPER_SAMPLE_RATE: usize = 16_000;
const MAX_AUDIO_DURATION_SECONDS: usize = 5 * 60;
const MAX_TRANSCRIPTION_SAMPLES: usize = WHISPER_SAMPLE_RATE * MAX_AUDIO_DURATION_SECONDS;
const MAX_CLOUD_STT_RESPONSE_BYTES: usize = 1024 * 1024;

fn append_recorded_samples(samples: &mut Vec<f32>, mono: &[f32], max_samples: usize) {
    let remaining = max_samples.saturating_sub(samples.len());
    samples.extend_from_slice(&mono[..mono.len().min(remaining)]);
}

fn validate_recording_session_id(session_id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(session_id)
        .map(|_| ())
        .map_err(|_| AppError::ConfigIo("Invalid recording session ID".to_string()))
}

fn recorded_audio_for_session(session_id: &str) -> Result<(Vec<f32>, u32), AppError> {
    validate_recording_session_id(session_id)?;
    let recorded = RECORDED_AUDIO
        .lock()
        .map_err(|error| AppError::ConfigIo(format!("Failed to lock recorded audio: {error}")))?;
    if recorded.session_id.as_deref() != Some(session_id) {
        return Err(AppError::ConfigIo(
            "Recording session is no longer active".to_string(),
        ));
    }
    Ok((recorded.samples.clone(), recorded.sample_rate))
}

pub struct BoundedAudioSamples(Vec<f32>);

impl<'de> serde::Deserialize<'de> for BoundedAudioSamples {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct SamplesVisitor;

        impl<'de> Visitor<'de> for SamplesVisitor {
            type Value = BoundedAudioSamples;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(
                    formatter,
                    "at most {MAX_TRANSCRIPTION_SAMPLES} finite audio samples"
                )
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                if sequence
                    .size_hint()
                    .is_some_and(|size| size > MAX_TRANSCRIPTION_SAMPLES)
                {
                    return Err(serde::de::Error::custom("Audio exceeds the 5 minute limit"));
                }

                let mut samples = Vec::with_capacity(
                    sequence
                        .size_hint()
                        .unwrap_or_default()
                        .min(MAX_TRANSCRIPTION_SAMPLES),
                );
                while let Some(sample) = sequence.next_element::<f32>()? {
                    if samples.len() == MAX_TRANSCRIPTION_SAMPLES {
                        return Err(serde::de::Error::custom("Audio exceeds the 5 minute limit"));
                    }
                    if !sample.is_finite() {
                        return Err(serde::de::Error::custom(
                            "Audio samples must contain only finite values",
                        ));
                    }
                    samples.push(sample);
                }
                Ok(BoundedAudioSamples(samples))
            }
        }

        deserializer.deserialize_seq(SamplesVisitor)
    }
}

fn validate_transcription_samples(samples: &[f32]) -> Result<(), AppError> {
    if samples.len() > MAX_TRANSCRIPTION_SAMPLES {
        return Err(AppError::ConfigIo(
            "Audio exceeds the 5 minute transcription limit".to_string(),
        ));
    }
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err(AppError::ConfigIo(
            "Audio samples must contain only finite values".to_string(),
        ));
    }
    Ok(())
}

struct RecordingSession {
    id: String,
    stream: cpal::Stream,
}

static RECORDING_SESSION: LazyLock<Mutex<Option<RecordingSession>>> =
    LazyLock::new(|| Mutex::new(None));

#[tauri::command]
pub async fn start_recording(session_id: String) -> Result<(), AppError> {
    validate_recording_session_id(&session_id)?;

    if let Ok(mut active) = RECORDING_SESSION.lock() {
        if let Some(previous) = active.take() {
            let _ = previous.stream.pause();
        }
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;

    let config = device
        .default_input_config()
        .map_err(|e| AppError::ConfigIo(format!("Failed to get default input config: {}", e)))?;

    let channels = config.channels();
    let sample_rate = config.sample_rate();
    let max_recorded_samples = (sample_rate as usize).saturating_mul(MAX_AUDIO_DURATION_SECONDS);
    {
        let mut recorded = RECORDED_AUDIO.lock().map_err(|error| {
            AppError::ConfigIo(format!("Failed to initialize recorded audio: {error}"))
        })?;
        recorded.session_id = Some(session_id.clone());
        recorded.sample_rate = sample_rate;
        recorded.samples.clear();
    }
    let audio_clone = RECORDED_AUDIO.clone();

    let error_callback = |err| {
        log::error!("An error occurred on the audio stream: {}", err);
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let callback_session_id = session_id.clone();
            device.build_input_stream(
                config.into(),
                move |data: &[f32], _| {
                    if let Ok(mut recorded) = audio_clone.lock() {
                        if recorded.session_id.as_deref() != Some(&callback_session_id) {
                            return;
                        }
                        let mono = convert_to_mono(data, channels);
                        append_recorded_samples(&mut recorded.samples, &mono, max_recorded_samples);
                    }
                },
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let callback_session_id = session_id.clone();
            device.build_input_stream(
                config.into(),
                move |data: &[i16], _| {
                    if let Ok(mut recorded) = audio_clone.lock() {
                        if recorded.session_id.as_deref() != Some(&callback_session_id) {
                            return;
                        }
                        let float_data: Vec<f32> =
                            data.iter().map(|sample| *sample as f32 / 32768.0).collect();
                        let mono = convert_to_mono(&float_data, channels);
                        append_recorded_samples(&mut recorded.samples, &mono, max_recorded_samples);
                    }
                },
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let callback_session_id = session_id.clone();
            device.build_input_stream(
                config.into(),
                move |data: &[u16], _| {
                    if let Ok(mut recorded) = audio_clone.lock() {
                        if recorded.session_id.as_deref() != Some(&callback_session_id) {
                            return;
                        }
                        let float_data: Vec<f32> = data
                            .iter()
                            .map(|sample| (*sample as f32 - 32768.0) / 32768.0)
                            .collect();
                        let mono = convert_to_mono(&float_data, channels);
                        append_recorded_samples(&mut recorded.samples, &mono, max_recorded_samples);
                    }
                },
                error_callback,
                None,
            )
        }
        _ => return Err(AppError::ConfigIo("Unsupported sample format".to_string())),
    }
    .map_err(|e| AppError::ConfigIo(format!("Failed to build input stream: {}", e)))?;

    stream
        .play()
        .map_err(|e| AppError::ConfigIo(format!("Failed to play stream: {}", e)))?;

    let session_is_current = RECORDED_AUDIO
        .lock()
        .map(|recorded| recorded.session_id.as_deref() == Some(&session_id))
        .unwrap_or(false);
    if !session_is_current {
        let _ = stream.pause();
        return Err(AppError::ConfigIo(
            "Recording session was superseded before it started".to_string(),
        ));
    }
    if let Ok(mut active) = RECORDING_SESSION.lock() {
        *active = Some(RecordingSession {
            id: session_id,
            stream,
        });
    } else {
        let _ = stream.pause();
        return Err(AppError::ConfigIo(
            "Failed to store the recording session".to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(session_id: String) -> Result<(), AppError> {
    validate_recording_session_id(&session_id)?;
    let mut active = RECORDING_SESSION
        .lock()
        .map_err(|error| AppError::ConfigIo(format!("Failed to stop recording: {error}")))?;
    if active
        .as_ref()
        .is_some_and(|recording| recording.id == session_id)
    {
        if let Some(recording) = active.take() {
            let _ = recording.stream.pause();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_recorded_samples(session_id: String) -> Result<Vec<f32>, AppError> {
    let (samples, sample_rate) = recorded_audio_for_session(&session_id)?;
    let resampled = resample(&samples, sample_rate, 16000);
    Ok(resampled)
}

static WHISPER_CONTEXT_CACHE: LazyLock<Mutex<Option<(String, WhisperContext)>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WhisperDownloadProgress {
    model_id: String,
    downloaded: u64,
    total: Option<u64>,
    percentage: f32,
    done: bool,
}

struct ActiveWhisperDownload {
    operation_id: u64,
    cancelled: Arc<AtomicBool>,
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
struct WhisperDownloadState {
    active: Option<ActiveWhisperDownload>,
}

struct WhisperDownloadRegistration {
    cancelled: Arc<AtomicBool>,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
}

impl WhisperDownloadState {
    fn begin(&mut self, operation_id: u64) -> Result<WhisperDownloadRegistration, AppError> {
        if self.active.is_some() {
            return Err(AppError::ConfigIo(
                "A Whisper model download is already in progress".to_string(),
            ));
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        self.active = Some(ActiveWhisperDownload {
            operation_id,
            cancelled: cancelled.clone(),
            cancel_tx: Some(cancel_tx),
        });

        Ok(WhisperDownloadRegistration {
            cancelled,
            cancel_rx,
        })
    }

    fn cancel_active(&mut self) {
        if let Some(active) = self.active.as_mut() {
            active.cancelled.store(true, Ordering::SeqCst);
            if let Some(cancel_tx) = active.cancel_tx.take() {
                let _ = cancel_tx.send(());
            }
        }
    }

    fn finish(&mut self, operation_id: u64) {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.operation_id == operation_id)
        {
            self.active = None;
        }
    }
}

static WHISPER_DOWNLOAD_STATE: LazyLock<Mutex<WhisperDownloadState>> =
    LazyLock::new(|| Mutex::new(WhisperDownloadState::default()));
static NEXT_WHISPER_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);

const MAX_WHISPER_MODEL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const WHISPER_MODEL_REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

struct WhisperPresetDownload {
    file_name: &'static str,
    sha256: &'static str,
    size: u64,
}

fn whisper_preset_download(model_id: &str) -> Result<WhisperPresetDownload, AppError> {
    let preset = match model_id {
        "tiny.en" => WhisperPresetDownload {
            file_name: "ggml-tiny.en.bin",
            sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
            size: 77_704_715,
        },
        "tiny" => WhisperPresetDownload {
            file_name: "ggml-tiny.bin",
            sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
            size: 77_691_713,
        },
        "base.en" => WhisperPresetDownload {
            file_name: "ggml-base.en.bin",
            sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
            size: 147_964_211,
        },
        "base" => WhisperPresetDownload {
            file_name: "ggml-base.bin",
            sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            size: 147_951_465,
        },
        "small.en" => WhisperPresetDownload {
            file_name: "ggml-small.en.bin",
            sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
            size: 487_614_201,
        },
        "small" => WhisperPresetDownload {
            file_name: "ggml-small.bin",
            sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            size: 487_601_967,
        },
        "large-v3-turbo" => WhisperPresetDownload {
            file_name: "ggml-large-v3-turbo.bin",
            sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
            size: 1_624_555_275,
        },
        _ => {
            return Err(AppError::ConfigIo(
                "Unknown Whisper model preset".to_string(),
            ))
        }
    };
    Ok(preset)
}

fn whisper_models_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(error.to_string()))?;
    Ok(app_data_dir.join("whisper_models"))
}

fn has_valid_whisper_header(header: &[u8]) -> bool {
    matches!(header, b"lmgg" | b"GGUF")
}

async fn validate_whisper_model_header(path: &Path) -> Result<(), AppError> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut header = [0u8; 4];
    file.read_exact(&mut header).await.map_err(|_| {
        AppError::ParseError("Whisper model is too small to contain a valid header".to_string())
    })?;
    if !has_valid_whisper_header(&header) {
        return Err(AppError::ParseError(
            "Whisper model has an invalid GGML/GGUF header".to_string(),
        ));
    }
    Ok(())
}

fn encode_sha256(digest: &[u8]) -> String {
    use std::fmt::Write;

    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(encoded, "{byte:02x}");
    }
    encoded
}

fn resolve_whisper_model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, AppError> {
    let file_name = validate_whisper_model_file_name(file_name)?;
    let models_dir = whisper_models_dir(app)?;
    fs::create_dir_all(&models_dir)?;
    let canonical_root = fs::canonicalize(&models_dir)?;
    let candidate = models_dir.join(file_name);
    let canonical_model = fs::canonicalize(&candidate).map_err(|_| {
        AppError::ConfigIo(format!("Whisper model file was not found: {file_name}"))
    })?;
    if !canonical_model.starts_with(&canonical_root) || !canonical_model.is_file() {
        return Err(AppError::AppPath(
            "Whisper model must be a regular file in the managed model directory".to_string(),
        ));
    }
    Ok(canonical_model)
}

fn whisper_download_staging_paths(models_dir: &Path, operation_id: u64) -> (PathBuf, PathBuf) {
    let process_id = std::process::id();
    (
        models_dir.join(format!(
            ".whisper-download-{process_id}-{operation_id}.part"
        )),
        models_dir.join(format!(
            ".whisper-download-{process_id}-{operation_id}.backup"
        )),
    )
}

async fn remove_partial_download(partial_path: &Path) {
    if let Err(error) = tokio::fs::remove_file(partial_path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "Failed to remove partial Whisper download {}: {}",
                partial_path.display(),
                error
            );
        }
    }
}

async fn promote_whisper_download(
    partial_path: &Path,
    destination_path: &Path,
    _backup_path: &Path,
) -> Result<(), AppError> {
    match tokio::fs::symlink_metadata(destination_path).await {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(AppError::ConfigIo(format!(
                "Refusing to replace non-file Whisper model destination: {}",
                destination_path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    #[cfg(not(target_os = "windows"))]
    {
        tokio::fs::rename(partial_path, destination_path).await?;
    }

    // Windows rename does not replace an existing file. Preserve the old model as a
    // uniquely named backup until the fully validated partial download is in place.
    #[cfg(target_os = "windows")]
    {
        let destination_exists = tokio::fs::try_exists(destination_path).await?;
        if !destination_exists {
            tokio::fs::rename(partial_path, destination_path).await?;
            return Ok(());
        }

        tokio::fs::rename(destination_path, _backup_path).await?;
        if let Err(promote_error) = tokio::fs::rename(partial_path, destination_path).await {
            return match tokio::fs::rename(_backup_path, destination_path).await {
                Ok(()) => Err(promote_error.into()),
                Err(restore_error) => Err(AppError::ConfigIo(format!(
                    "Failed to promote Whisper model ({promote_error}) and restore the previous model ({restore_error}); the previous model remains at {}",
                    _backup_path.display()
                ))),
            };
        }

        if let Err(error) = tokio::fs::remove_file(_backup_path).await {
            log::warn!(
                "Whisper model was updated, but its temporary backup could not be removed at {}: {}",
                _backup_path.display(),
                error
            );
        }
    }

    Ok(())
}

fn validate_whisper_model_file_name(file_name: &str) -> Result<&str, AppError> {
    if file_name.is_empty() || file_name.len() > 255 {
        return Err(AppError::AppPath(
            "Invalid Whisper model file name".to_string(),
        ));
    }

    // Reject both platform separators so a persisted model name stays safe if the
    // app data directory is later used on another operating system.
    if file_name.contains(['/', '\\', '\0']) {
        return Err(AppError::AppPath(
            "Whisper model file name must not contain a path".to_string(),
        ));
    }

    let path = Path::new(file_name);
    let mut components = path.components();
    let is_single_file =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !is_single_file || path.file_name().and_then(|name| name.to_str()) != Some(file_name) {
        return Err(AppError::AppPath(
            "Whisper model file name must not contain a path".to_string(),
        ));
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("bin") && !extension.eq_ignore_ascii_case("gguf") {
        return Err(AppError::AppPath(
            "Whisper model file must use a .bin or .gguf extension".to_string(),
        ));
    }

    Ok(file_name)
}

#[tauri::command]
pub async fn cancel_whisper_download() -> Result<(), AppError> {
    WHISPER_DOWNLOAD_STATE
        .lock()
        .map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?
        .cancel_active();
    Ok(())
}

#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, model_id: String) -> Result<String, AppError> {
    crate::ensure_online()?;
    let preset = whisper_preset_download(&model_id)?;
    let operation_id = NEXT_WHISPER_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed);
    let WhisperDownloadRegistration {
        cancelled,
        mut cancel_rx,
    } = WHISPER_DOWNLOAD_STATE
        .lock()
        .map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?
        .begin(operation_id)?;

    struct DownloadStateGuard {
        operation_id: u64,
    }
    impl Drop for DownloadStateGuard {
        fn drop(&mut self) {
            if let Ok(mut state) = WHISPER_DOWNLOAD_STATE.lock() {
                state.finish(self.operation_id);
            }
        }
    }
    let _state_guard = DownloadStateGuard { operation_id };

    let models_dir = whisper_models_dir(&app)?;
    fs::create_dir_all(&models_dir)?;

    let destination_path = models_dir.join(preset.file_name);
    let (partial_path, backup_path) = whisper_download_staging_paths(&models_dir, operation_id);

    let result = async {
        let mut current_url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/{WHISPER_MODEL_REVISION}/{}",
            preset.file_name
        );
        let mut redirects = 0u8;
        let res = loop {
            let endpoint = crate::endpoint_security::validate_http_endpoint(
                &current_url,
                false,
                std::time::Duration::from_secs(300),
            )
            .await?;
            if endpoint.url.scheme() != "https" {
                return Err(AppError::RequestFailed(
                    "Whisper models must be downloaded over HTTPS".to_string(),
                ));
            }
            let response = tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                }
                res_result = endpoint.client.get(endpoint.url.clone()).send() => {
                    res_result.map_err(|e| AppError::RequestFailed(e.to_string()))?
                }
            };
            if !response.status().is_redirection() {
                break response;
            }
            if redirects >= 5 {
                return Err(AppError::RequestFailed(
                    "Whisper model download exceeded the redirect limit".to_string(),
                ));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .ok_or_else(|| {
                    AppError::RequestFailed(
                        "Whisper model download redirect omitted the Location header".to_string(),
                    )
                })?
                .to_str()
                .map_err(|_| {
                    AppError::RequestFailed(
                        "Whisper model download redirect had an invalid Location header"
                            .to_string(),
                    )
                })?;
            current_url = endpoint
                .url
                .join(location)
                .map_err(|error| AppError::RequestFailed(format!("Invalid redirect URL: {error}")))?
                .to_string();
            redirects += 1;
        };
        if !res.status().is_success() {
            return Err(AppError::RequestFailed(format!(
                "Model download failed with HTTP status {}",
                res.status()
            )));
        }
        let total_size = res.content_length();
        if total_size.is_some_and(|size| size != preset.size) {
            return Err(AppError::RequestFailed(
                "Whisper model content length did not match the pinned manifest".to_string(),
            ));
        }
        if total_size.is_some_and(|size| size > MAX_WHISPER_MODEL_BYTES) {
            return Err(AppError::RequestFailed(format!(
                "Whisper model exceeds the {} GiB download limit",
                MAX_WHISPER_MODEL_BYTES / (1024 * 1024 * 1024)
            )));
        }

        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)
            .await?;
        let mut stream = res.bytes_stream();
        let mut downloaded = 0u64;
        let mut digest = DigestContext::new(&SHA256);
        let mut last_emit_time = std::time::Instant::now();
        let mut last_emitted_percentage = -1.0f32;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                }
                chunk_result_opt = stream.next() => {
                    match chunk_result_opt {
                        Some(chunk_result) => {
                            if cancelled.load(Ordering::SeqCst) {
                                return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                            }
                            let chunk = chunk_result.map_err(|e| AppError::RequestFailed(e.to_string()))?;
                            let next_downloaded = downloaded.saturating_add(chunk.len() as u64);
                            if next_downloaded > MAX_WHISPER_MODEL_BYTES {
                                return Err(AppError::RequestFailed(format!(
                                    "Whisper model exceeds the {} GiB download limit",
                                    MAX_WHISPER_MODEL_BYTES / (1024 * 1024 * 1024)
                                )));
                            }
                            if total_size.is_some_and(|total| next_downloaded > total) {
                                return Err(AppError::RequestFailed(
                                    "Whisper model download exceeded its declared content length".to_string(),
                                ));
                            }
                            file.write_all(&chunk).await?;
                            digest.update(&chunk);
                            downloaded = next_downloaded;

                            let percentage = total_size
                                .map(|total| (downloaded as f32 / total as f32) * 100.0)
                                .unwrap_or(0.0);

                            let now = std::time::Instant::now();
                            let should_emit = if total_size.is_some() {
                                (percentage - last_emitted_percentage) >= 1.0
                                    || now.duration_since(last_emit_time)
                                        >= std::time::Duration::from_millis(100)
                            } else {
                                now.duration_since(last_emit_time)
                                    >= std::time::Duration::from_millis(100)
                            };

                            if should_emit {
                                last_emit_time = now;
                                last_emitted_percentage = percentage;
                                let _ = app.emit(
                                    "whisper-download-progress",
                                    WhisperDownloadProgress {
                                        model_id: model_id.clone(),
                                        downloaded,
                                        total: total_size,
                                        percentage,
                                        done: false,
                                    },
                                );
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        if downloaded == 0 {
            return Err(AppError::RequestFailed(
                "Whisper model download was empty".to_string(),
            ));
        }
        if total_size.is_some_and(|total| downloaded != total) {
            return Err(AppError::RequestFailed(format!(
                "Whisper model download was incomplete: received {downloaded} of {} bytes",
                total_size.unwrap_or_default()
            )));
        }
        if downloaded != preset.size {
            return Err(AppError::RequestFailed(
                "Whisper model size did not match the pinned manifest".to_string(),
            ));
        }

        file.flush().await?;
        file.sync_all().await?;
        drop(file);

        let actual_sha256 = encode_sha256(digest.finish().as_ref());
        if actual_sha256 != preset.sha256 {
            return Err(AppError::RequestFailed(
                "Whisper model checksum verification failed".to_string(),
            ));
        }
        validate_whisper_model_header(&partial_path).await?;

        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError::ConfigIo(
                "Download cancelled by user".to_string(),
            ));
        }

        promote_whisper_download(&partial_path, &destination_path, &backup_path).await?;

        let _ = app.emit(
            "whisper-download-progress",
            WhisperDownloadProgress {
                model_id: model_id.clone(),
                downloaded,
                total: total_size,
                percentage: 100.0,
                done: true,
            },
        );

        Ok(destination_path.to_string_lossy().to_string())
    }
    .await;

    if result.is_err() {
        remove_partial_download(&partial_path).await;
    }

    result
}

#[tauri::command]
pub async fn import_custom_whisper_model(app: AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let selected = app
        .dialog()
        .file()
        .set_title("Select an unverified Whisper model")
        .add_filter("Whisper GGML/GGUF model", &["bin", "gguf"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected_path = match selected {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(url) => url
            .to_file_path()
            .map_err(|_| AppError::AppPath("Invalid model file URL".to_string()))?,
    };
    let source_path = fs::canonicalize(selected_path)?;
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::AppPath("Invalid custom model file name".to_string()))?;
    validate_whisper_model_file_name(source_name)?;

    let source = tokio::fs::File::open(&source_path).await?;
    let source_metadata = source.metadata().await?;
    if !source_metadata.is_file() || source_metadata.len() == 0 {
        return Err(AppError::ConfigIo(
            "Custom Whisper model must be a non-empty regular file".to_string(),
        ));
    }
    if source_metadata.len() > MAX_WHISPER_MODEL_BYTES {
        return Err(AppError::ConfigIo(format!(
            "Custom Whisper model exceeds the {} GiB limit",
            MAX_WHISPER_MODEL_BYTES / (1024 * 1024 * 1024)
        )));
    }

    let models_dir = whisper_models_dir(&app)?;
    fs::create_dir_all(&models_dir)?;
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let imported_name = format!("unverified-{}.{}", uuid::Uuid::new_v4(), extension);
    let destination_path = models_dir.join(&imported_name);
    let partial_path = models_dir.join(format!(".{imported_name}.part"));

    let copy_result = async {
        let mut source = source;
        let mut destination = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)
            .await?;
        let mut buffer = vec![0u8; 64 * 1024];
        let mut copied = 0u64;
        loop {
            let read = source.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            copied = copied.saturating_add(read as u64);
            if copied > MAX_WHISPER_MODEL_BYTES {
                return Err(AppError::ConfigIo(
                    "Custom Whisper model grew beyond the import limit".to_string(),
                ));
            }
            destination.write_all(&buffer[..read]).await?;
        }
        destination.flush().await?;
        destination.sync_all().await?;
        drop(destination);
        validate_whisper_model_header(&partial_path).await?;
        tokio::fs::rename(&partial_path, &destination_path).await?;
        Ok::<(), AppError>(())
    }
    .await;

    if copy_result.is_err() {
        remove_partial_download(&partial_path).await;
    }
    copy_result?;
    Ok(Some(imported_name))
}

#[tauri::command]
pub async fn check_downloaded_whisper_models(app: AppHandle) -> Result<Vec<String>, AppError> {
    let models_dir = whisper_models_dir(&app)?;
    if !models_dir.exists() {
        return Ok(vec![]);
    }

    let mut downloaded = Vec::new();
    let mut entries = fs::read_dir(models_dir)?;
    while let Some(Ok(entry)) = entries.next() {
        if let Some(name) = entry.file_name().to_str() {
            if validate_whisper_model_file_name(name).is_ok() && entry.path().is_file() {
                downloaded.push(name.to_string());
            }
        }
    }
    Ok(downloaded)
}

#[tauri::command]
pub async fn delete_whisper_model(app: AppHandle, file_name: String) -> Result<(), AppError> {
    match resolve_whisper_model_path(&app, &file_name) {
        Ok(model_path) => fs::remove_file(model_path)?,
        Err(AppError::ConfigIo(_)) => {}
        Err(error) => return Err(error),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        has_valid_whisper_header, promote_whisper_download, remove_partial_download,
        validate_recording_session_id, validate_transcription_samples,
        validate_whisper_model_file_name, whisper_download_staging_paths, whisper_preset_download,
        WhisperDownloadState, MAX_TRANSCRIPTION_SAMPLES, NEXT_WHISPER_DOWNLOAD_ID,
    };
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let test_id = NEXT_WHISPER_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "sythoria-whisper-download-test-{}-{test_id}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn whisper_model_file_name_accepts_supported_basenames() {
        assert!(validate_whisper_model_file_name("ggml-base.en.bin").is_ok());
        assert!(validate_whisper_model_file_name("whisper-small.GGUF").is_ok());
    }

    #[test]
    fn whisper_model_file_name_rejects_paths_and_unsupported_files() {
        for invalid in [
            "../victim.bin",
            "folder/model.bin",
            r"folder\model.bin",
            "/tmp/model.bin",
            "model.txt",
            "",
        ] {
            assert!(
                validate_whisper_model_file_name(invalid).is_err(),
                "accepted unsafe file name: {invalid}"
            );
        }
    }

    #[test]
    fn whisper_presets_are_allowlisted_with_pinned_hashes() {
        let tiny = whisper_preset_download("tiny.en").expect("known preset");
        assert_eq!(tiny.file_name, "ggml-tiny.en.bin");
        assert_eq!(tiny.sha256.len(), 64);
        assert!(whisper_preset_download("renderer-controlled").is_err());
    }

    #[test]
    fn whisper_headers_accept_ggml_and_gguf_only() {
        assert!(has_valid_whisper_header(b"lmgg"));
        assert!(has_valid_whisper_header(b"GGUF"));
        assert!(!has_valid_whisper_header(b"MZ\0\0"));
        assert!(!has_valid_whisper_header(b"PK\x03\x04"));
    }

    #[test]
    fn transcription_samples_are_bounded_and_finite() {
        assert!(validate_transcription_samples(&[0.0, -0.5, 1.0]).is_ok());
        assert!(validate_transcription_samples(&[f32::NAN]).is_err());
        assert!(validate_transcription_samples(&vec![0.0; MAX_TRANSCRIPTION_SAMPLES + 1]).is_err());
    }

    #[test]
    fn recording_sessions_require_uuid_identifiers() {
        assert!(validate_recording_session_id("d6ad5d62-1af0-4b66-a825-dfebc9651f8d").is_ok());
        assert!(validate_recording_session_id("recording-1").is_err());
        assert!(validate_recording_session_id("").is_err());
    }

    #[test]
    fn whisper_download_state_rejects_overlap_and_scopes_cancellation() {
        let mut state = WhisperDownloadState::default();
        let mut first = state.begin(41).expect("start first download");

        assert!(state.begin(42).is_err());
        state.cancel_active();
        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(first.cancel_rx.try_recv().is_ok());

        state.finish(999);
        assert!(state.begin(42).is_err());
        state.finish(41);
        assert!(state.begin(42).is_ok());
    }

    #[test]
    fn staging_paths_are_unique_and_do_not_reuse_the_destination_name() {
        let models_dir = PathBuf::from("models");
        let (first_partial, first_backup) = whisper_download_staging_paths(&models_dir, 1);
        let (second_partial, second_backup) = whisper_download_staging_paths(&models_dir, 2);

        assert_ne!(first_partial, second_partial);
        assert_ne!(first_backup, second_backup);
        assert_eq!(
            first_partial.extension().and_then(|value| value.to_str()),
            Some("part")
        );
        assert_eq!(
            first_backup.extension().and_then(|value| value.to_str()),
            Some("backup")
        );
    }

    #[tokio::test]
    async fn promotion_replaces_a_model_only_after_the_partial_is_complete() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let partial = test_dir.0.join("download.part");
        let backup = test_dir.0.join("download.backup");
        std::fs::write(&destination, b"previous model").expect("write previous model");
        std::fs::write(&partial, b"validated new model").expect("write staged model");

        promote_whisper_download(&partial, &destination, &backup)
            .await
            .expect("promote staged model");

        assert_eq!(
            std::fs::read(&destination).expect("read promoted model"),
            b"validated new model"
        );
        assert!(!partial.exists());
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn failed_promotion_preserves_the_existing_model() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let missing_partial = test_dir.0.join("missing.part");
        let backup = test_dir.0.join("download.backup");
        std::fs::write(&destination, b"previous model").expect("write previous model");

        assert!(
            promote_whisper_download(&missing_partial, &destination, &backup)
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read(&destination).expect("read preserved model"),
            b"previous model"
        );
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn partial_cleanup_does_not_remove_an_existing_model() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let partial = test_dir.0.join("download.part");
        std::fs::write(&destination, b"previous model").expect("write previous model");
        std::fs::write(&partial, b"incomplete model").expect("write partial model");

        remove_partial_download(&partial).await;

        assert!(!partial.exists());
        assert_eq!(
            std::fs::read(&destination).expect("read preserved model"),
            b"previous model"
        );
    }
}

#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    model_path: String,
    audio_data: BoundedAudioSamples,
    language: Option<String>,
    recording_session_id: Option<String>,
) -> Result<String, AppError> {
    let resolved_path = resolve_whisper_model_path(&app, &model_path)?;
    validate_whisper_model_header(&resolved_path).await?;

    let resolved_path_str = resolved_path.to_string_lossy().to_string();

    let actual_audio_data = if audio_data.0.is_empty() {
        let session_id = recording_session_id.ok_or_else(|| {
            AppError::ConfigIo("Recording session ID is required for captured audio".to_string())
        })?;
        let (samples, sample_rate) = recorded_audio_for_session(&session_id)?;
        resample(&samples, sample_rate, 16000)
    } else {
        audio_data.0
    };
    validate_transcription_samples(&actual_audio_data)?;

    let ctx_clone = resolved_path_str.clone();
    let audio_clone = actual_audio_data;
    let lang_clone = language.unwrap_or("auto".to_string());

    let transcription = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let mut cache = WHISPER_CONTEXT_CACHE
            .lock()
            .map_err(|e| AppError::ParseError(format!("Cache lock poisoned: {}", e)))?;

        let matches = match &*cache {
            Some((path, _)) => path == &ctx_clone,
            None => false,
        };

        if !matches {
            let ctx =
                WhisperContext::new_with_params(&ctx_clone, WhisperContextParameters::default())
                    .map_err(|e| {
                        AppError::ParseError(format!("Failed to load Whisper context: {}", e))
                    })?;
            *cache = Some((ctx_clone.clone(), ctx));
        }

        let context = &cache
            .as_ref()
            .ok_or_else(|| AppError::ParseError("Whisper cache is empty".to_string()))?
            .1;

        let mut state = context
            .create_state()
            .map_err(|e| AppError::ParseError(format!("Failed to create state: {}", e)))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(false);

        if lang_clone != "auto" {
            params.set_language(Some(&lang_clone));
        } else {
            params.set_language(None);
        }

        state
            .full(params, &audio_clone)
            .map_err(|e| AppError::ParseError(format!("Failed to run Whisper model: {}", e)))?;

        let num_segments = state.full_n_segments();
        let mut text = String::new();
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                text.push_str(&segment.to_string());
            }
        }
        Ok(text)
    })
    .await
    .map_err(|e| AppError::ParseError(format!("Task panicked: {}", e)))??;

    Ok(transcription)
}

fn encode_wav_f32(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let data_len = samples.len() * 4;
    let file_len = 36 + data_len;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(file_len as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * 4;
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[derive(serde::Deserialize)]
struct CloudWhisperResponse {
    text: String,
}

#[tauri::command]
pub async fn transcribe_audio_cloud(
    app: AppHandle,
    api_url: String,
    model: String,
    language: Option<String>,
    recording_session_id: String,
) -> Result<String, AppError> {
    crate::ensure_online()?;
    let api_key =
        crate::commands::config::get_cloud_stt_api_key(&app).map_err(|err| match err {
            AppError::KeyNotFound(_) => {
                AppError::ConfigIo("Cloud speech-to-text API key is not configured".to_string())
            }
            other => other,
        })?;
    let (samples, sample_rate) = recorded_audio_for_session(&recording_session_id)?;

    if samples.is_empty() {
        return Ok(String::new());
    }

    let endpoint = crate::endpoint_security::validate_http_endpoint(
        &api_url,
        true,
        std::time::Duration::from_secs(120),
    )
    .await?;

    let resampled = resample(&samples, sample_rate, 16000);
    let wav_bytes = encode_wav_f32(&resampled, 16000);

    let part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::ParseError(format!("Failed to create multipart part: {}", e)))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let res = endpoint
        .client
        .post(endpoint.url)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::ParseError(format!("Network Error: {}", e)))?;

    let status = res.status();
    if res.content_length().unwrap_or_default() > MAX_CLOUD_STT_RESPONSE_BYTES as u64 {
        return Err(AppError::ParseError(
            "Cloud speech-to-text response exceeded the 1 MiB limit".to_string(),
        ));
    }
    let mut response_bytes = Vec::new();
    let mut response_stream = res.bytes_stream();
    while let Some(chunk) = response_stream.next().await {
        let chunk = chunk
            .map_err(|e| AppError::ParseError(format!("Failed to read API response: {}", e)))?;
        if response_bytes.len().saturating_add(chunk.len()) > MAX_CLOUD_STT_RESPONSE_BYTES {
            return Err(AppError::ParseError(
                "Cloud speech-to-text response exceeded the 1 MiB limit".to_string(),
            ));
        }
        response_bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&response_bytes);

    if !status.is_success() {
        return Err(AppError::ParseError(format!(
            "API Error {}: {}",
            status, body
        )));
    }

    let json: CloudWhisperResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::ParseError(format!("Failed to parse JSON response: {}", e)))?;

    Ok(json.text)
}
