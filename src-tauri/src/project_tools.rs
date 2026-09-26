use crate::project::{ProjectExclusions, ProjectPermission, ProjectRegistry};
use crate::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;

const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 120_000;
const MAX_COMMAND_TIMEOUT_MS: u64 = 600_000;
const MAX_COMMAND_OUTPUT_BYTES: usize = 1024 * 1024;

fn command_confirmation_authorized(project: &crate::project::Project, acknowledged: bool) -> bool {
    project.skip_command_confirmations.unwrap_or(false) || acknowledged
}

struct ValidatedProjectAccess {
    path: PathBuf,
    exclusions: ProjectExclusions,
}

fn get_and_validate_project(
    state: &ProjectRegistry,
    project_id: &str,
    run_token: &str,
    relative_path: &str,
    required_permission: &str,
    worktree_path: Option<&str>,
) -> Result<ValidatedProjectAccess, AppError> {
    // Native run capabilities authorize one immutable project filesystem root.
    // The currently visible project is intentionally irrelevant to an active run.
    let capability_root = crate::project::validate_project_run_access(
        state,
        run_token,
        project_id,
        worktree_path,
        required_permission == "write",
    )?;

    let projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let mut project = projects_guard
        .get(project_id)
        .ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?
        .clone();
    drop(projects_guard);

    let root = match capability_root {
        Some(path) => path,
        None => crate::project::resolve_project_root(state, &project, project_id, None)?,
    };
    project.path = root.to_string_lossy().into_owned();

    let path = crate::project::validate_project_path(&project, relative_path, required_permission)?;
    let root = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {e}")))?;
    let exclusions = ProjectExclusions::new(&project, &root)?;
    Ok(ValidatedProjectAccess { path, exclusions })
}

#[tauri::command]
pub async fn project_read(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    worktree_path: Option<String>,
) -> Result<String, AppError> {
    let validated_path = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "read",
        worktree_path.as_deref(),
    )?
    .path;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let metadata = fs::metadata(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read metadata: {}", e)))?;
        let size = metadata.len();
        let content = if size > 10 * 1024 * 1024 {
            use std::io::{BufRead, BufReader};
            let file = fs::File::open(&validated_path)
                .map_err(|e| AppError::AppPath(format!("Failed to open file: {}", e)))?;
            let reader = BufReader::new(file);
            let mut lines = Vec::new();
            for line in reader.lines().take(5000) {
                lines.push(
                    line.map_err(|e| AppError::AppPath(format!("Failed to read line: {}", e)))?,
                );
            }
            lines.push(format!("\n--- [WARNING: File size is {:.2}MB, which exceeds the 10MB limit. Loaded first 5000 lines only] ---", size as f64 / (1024.0 * 1024.0)));
            lines.join("\n")
        } else {
            fs::read_to_string(&validated_path)
                .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?
        };

        if offset.is_some() || limit.is_some() {
            let lines: Vec<&str> = content.lines().collect();
            let start = offset.unwrap_or(1).saturating_sub(1);
            let count = limit.unwrap_or(2000);
            let end = (start + count).min(lines.len());

            if start >= lines.len() {
                return Ok(String::new());
            }

            let slice = &lines[start..end];
            Ok(slice.join("\n"))
        } else {
            Ok(content)
        }
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

// 5 MiB stays below the tool loop's 7,000,000-character base64 limit.
const MAX_PROJECT_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectImage {
    mime_type: String,
    data: String,
}

fn read_project_image(path: &Path) -> Result<ProjectImage, AppError> {
    use base64::Engine;
    use std::io::Read;

    let file = fs::File::open(path)
        .map_err(|e| AppError::AppPath(format!("Failed to open image: {e}")))?;
    let metadata = file
        .metadata()
        .map_err(|e| AppError::AppPath(format!("Failed to read image metadata: {e}")))?;
    if !metadata.is_file() {
        return Err(AppError::AppPath(
            "Image path must be a regular file".into(),
        ));
    }
    if metadata.len() > MAX_PROJECT_IMAGE_BYTES {
        return Err(AppError::AppPath("Image exceeds the 5 MiB limit".into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_PROJECT_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::AppPath(format!("Failed to read image: {e}")))?;
    if bytes.len() as u64 > MAX_PROJECT_IMAGE_BYTES {
        return Err(AppError::AppPath("Image exceeds the 5 MiB limit".into()));
    }
    let mime_type = match image::guess_format(&bytes) {
        Ok(image::ImageFormat::Png) => "image/png",
        Ok(image::ImageFormat::Jpeg) => "image/jpeg",
        Ok(image::ImageFormat::Gif) => "image/gif",
        Ok(image::ImageFormat::WebP) => "image/webp",
        _ => {
            return Err(AppError::AppPath(
                "Unsupported image format. Use PNG, JPEG, GIF, or WebP.".into(),
            ))
        }
    };
    Ok(ProjectImage {
        mime_type: mime_type.into(),
        data: base64::prelude::BASE64_STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub async fn project_read_image(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    worktree_path: Option<String>,
) -> Result<ProjectImage, AppError> {
    let validated_path = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "read",
        worktree_path.as_deref(),
    )?
    .path;
    tokio::task::spawn_blocking(move || read_project_image(&validated_path))
        .await
        .map_err(|e| AppError::AppPath(format!("Failed to join thread: {e}")))?
}

#[tauri::command]
pub async fn project_write(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    content: String,
    worktree_path: Option<String>,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "write",
        worktree_path.as_deref(),
    )?
    .path;
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = validated_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::AppPath(format!("Failed to create directories: {}", e)))?;
        }
        fs::write(&validated_path, content).map_err(|e| {
            AppError::AppPath(format!(
                "Failed to write file '{}': {}",
                validated_path.display(),
                e
            ))
        })
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[tauri::command]
pub async fn project_list_dir(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    worktree_path: Option<String>,
) -> Result<Vec<String>, AppError> {
    let access = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "read",
        worktree_path.as_deref(),
    )?;
    tokio::task::spawn_blocking(move || list_project_directory(access))
        .await
        .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

fn list_project_directory(access: ValidatedProjectAccess) -> Result<Vec<String>, AppError> {
    if !access.path.exists() || !access.path.is_dir() {
        return Err(AppError::AppPath(format!(
            "Directory does not exist: {}",
            access.path.display()
        )));
    }

    let mut entries = Vec::new();
    let dir = fs::read_dir(&access.path)
        .map_err(|e| AppError::AppPath(format!("Failed to read dir: {e}")))?;

    for entry in dir.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        if !access
            .exclusions
            .allows_discovered_path(&entry_path, is_dir)
        {
            continue;
        }
        entries.push(if is_dir {
            format!("{file_name}/")
        } else {
            file_name
        });
    }
    entries.sort();
    Ok(entries)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn project_bash(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    command: String,
    cwd: String,
    timeout: Option<u64>,
    run_in_background: Option<bool>,
    worktree_path: Option<String>,
    confirmation_acknowledged: bool,
) -> Result<String, AppError> {
    // Validate the immutable run capability and retrieve its project config.
    let capability_root = crate::project::validate_project_run_access(
        &state,
        &run_token,
        &project_id,
        worktree_path.as_deref(),
        true,
    )?;
    let mut project = {
        let projects_guard = state
            .projects
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        projects_guard
            .get(&project_id)
            .ok_or_else(|| {
                AppError::AppPath("Access denied: Project not found in registry".to_string())
            })?
            .clone()
    };

    let root = match capability_root {
        Some(path) => path,
        None => crate::project::resolve_project_root(&state, &project, &project_id, None)?,
    };
    project.path = root.to_string_lossy().into_owned();

    if project.permissions != ProjectPermission::Full {
        return Err(AppError::AppPath(
            "Permission denied: full shell access not allowed".to_string(),
        ));
    }
    if !command_confirmation_authorized(&project, confirmation_acknowledged) {
        return Err(AppError::AppPath(
            "Command execution requires in-app confirmation".to_string(),
        ));
    }

    // 2. Validate cwd is exactly the registered project root
    let root_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {}", e)))?;
    let cwd_path = Path::new(&cwd)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize cwd: {}", e)))?;

    if root_path != cwd_path {
        return Err(AppError::AppPath(
            "Access denied: command execution directory must be the project root".to_string(),
        ));
    }

    if run_in_background.unwrap_or(false) {
        return Err(AppError::AppPath(
            "Background commands are disabled until they can be tracked and stopped safely"
                .to_string(),
        ));
    }

    use tokio::process::Command as TokioCommand;
    let mut tcmd = if cfg!(target_os = "windows") {
        let mut c = TokioCommand::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = TokioCommand::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    tcmd.current_dir(&cwd_path);

    let timeout_ms = timeout
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS)
        .clamp(1_000, MAX_COMMAND_TIMEOUT_MS);
    tcmd.kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = tcmd
        .spawn()
        .map_err(|e| AppError::AppPath(format!("Failed to execute command: {}", e)))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::AppPath("Failed to capture command stdout".to_string()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::AppPath("Failed to capture command stderr".to_string()))?;

    let output_future = async move {
        let stdout_read = async move {
            let mut captured = Vec::new();
            let mut buffer = [0_u8; 8192];
            let mut truncated = false;
            loop {
                let count = stdout.read(&mut buffer).await?;
                if count == 0 {
                    break;
                }
                let remaining = MAX_COMMAND_OUTPUT_BYTES.saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..count.min(remaining)]);
                truncated |= count > remaining;
            }
            Ok::<_, std::io::Error>((captured, truncated))
        };
        let stderr_read = async move {
            let mut captured = Vec::new();
            let mut buffer = [0_u8; 8192];
            let mut truncated = false;
            loop {
                let count = stderr.read(&mut buffer).await?;
                if count == 0 {
                    break;
                }
                let remaining = MAX_COMMAND_OUTPUT_BYTES.saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..count.min(remaining)]);
                truncated |= count > remaining;
            }
            Ok::<_, std::io::Error>((captured, truncated))
        };
        let (status, stdout_result, stderr_result) =
            tokio::try_join!(child.wait(), stdout_read, stderr_read)?;
        Ok::<_, std::io::Error>((status, stdout_result, stderr_result))
    };

    let (status, (stdout_bytes, stdout_truncated), (stderr_bytes, stderr_truncated)) =
        tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), output_future)
            .await
            .map_err(|_| AppError::AppPath(format!("Command timed out after {}ms", timeout_ms)))?
            .map_err(|e| AppError::AppPath(format!("Failed to execute command: {}", e)))?;

    let mut result = String::new();
    if !stdout_bytes.is_empty() {
        result.push_str(&String::from_utf8_lossy(&stdout_bytes));
        if stdout_truncated {
            result.push_str("\n--- STDOUT TRUNCATED AT 1 MiB ---\n");
        }
    }
    if !stderr_bytes.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("--- STDERR ---\n");
        result.push_str(&String::from_utf8_lossy(&stderr_bytes));
        if stderr_truncated {
            result.push_str("\n--- STDERR TRUNCATED AT 1 MiB ---\n");
        }
    }

    if !status.success() {
        result = format!(
            "Command exited with error code: {}\n{}",
            status.code().unwrap_or(-1),
            result
        );
    }

    Ok(result)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Named IPC fields are part of the stable renderer command contract.
pub async fn project_edit(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    worktree_path: Option<String>,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "write",
        worktree_path.as_deref(),
    )?
    .path;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let content = fs::read_to_string(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;

        let allow_mult = replace_all.unwrap_or(false);
        let count = content.matches(&old_string).count();

        if count == 0 {
            return Err(AppError::AppPath(
                "Target content not found in file.".to_string(),
            ));
        }

        if !allow_mult && count > 1 {
            return Err(AppError::AppPath(format!(
                "Target content found {} times, but replace_all is false.",
                count
            )));
        }

        let new_content = content.replace(&old_string, &new_string);
        fs::write(&validated_path, new_content)
            .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[derive(serde::Deserialize)]
pub struct ReplacementChunk {
    pub target_content: String,
    pub replacement_content: String,
    pub allow_multiple: Option<bool>,
}

#[tauri::command]
pub async fn project_multi_replace_file_content(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    chunks: Vec<ReplacementChunk>,
    worktree_path: Option<String>,
) -> Result<(), AppError> {
    let validated_path = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "write",
        worktree_path.as_deref(),
    )?
    .path;
    tokio::task::spawn_blocking(move || {
        if !validated_path.exists() {
            return Err(AppError::AppPath(format!(
                "File does not exist: {}",
                validated_path.display()
            )));
        }
        let mut content = fs::read_to_string(&validated_path)
            .map_err(|e| AppError::AppPath(format!("Failed to read file: {}", e)))?;

        for (i, chunk) in chunks.iter().enumerate() {
            let count = content.matches(&chunk.target_content).count();
            let allow_mult = chunk.allow_multiple.unwrap_or(false);

            if count == 0 {
                return Err(AppError::AppPath(format!(
                    "Target content for chunk {} not found in file.",
                    i
                )));
            }

            if !allow_mult && count > 1 {
                return Err(AppError::AppPath(format!(
                    "Target content for chunk {} found {} times, but allow_multiple is false.",
                    i, count
                )));
            }

            content = content.replace(&chunk.target_content, &chunk.replacement_content);
        }

        fs::write(&validated_path, content)
            .map_err(|e| AppError::AppPath(format!("Failed to write file: {}", e)))
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

#[derive(serde::Serialize)]
#[serde(untagged)]
pub enum GrepResult {
    FilesWithMatches(Vec<String>),
    Content(Vec<GrepContentResult>),
    Count(usize),
}

#[derive(serde::Serialize)]
pub struct GrepContentResult {
    pub file: String,
    pub line: usize,
    pub content: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Named IPC fields are part of the stable renderer command contract.
pub async fn project_grep(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    pattern: String,
    output_mode: Option<String>,
    multiline: Option<bool>,
    worktree_path: Option<String>,
) -> Result<GrepResult, AppError> {
    let access = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "read",
        worktree_path.as_deref(),
    )?;
    tokio::task::spawn_blocking(move || {
        grep_project_files(access, &pattern, output_mode, multiline)
    })
    .await
    .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

fn grep_project_files(
    access: ValidatedProjectAccess,
    pattern: &str,
    output_mode: Option<String>,
    multiline: Option<bool>,
) -> Result<GrepResult, AppError> {
    if !access.path.exists() || !access.path.is_dir() {
        return Err(AppError::AppPath(format!(
            "Directory does not exist: {}",
            access.path.display()
        )));
    }

    let mode = output_mode.unwrap_or_else(|| "files_with_matches".to_string());
    let regex = regex::RegexBuilder::new(pattern)
        .multi_line(multiline.unwrap_or(false))
        .build()
        .map_err(|e| AppError::AppPath(format!("Invalid regex: {e}")))?;
    let mut files_with_matches = Vec::new();
    let mut content_results = Vec::new();
    let mut total_matches = 0;

    let traversal_exclusions = access.exclusions.clone();
    let mut walk_builder = ignore::WalkBuilder::new(&access.path);
    walk_builder
        .hidden(false)
        .git_ignore(true)
        .filter_entry(move |entry| {
            let is_dir = entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false);
            traversal_exclusions.allows_discovered_path(entry.path(), is_dir)
        });

    for entry in walk_builder.build().flatten() {
        if !entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
            || !access
                .exclusions
                .allows_discovered_path(entry.path(), false)
        {
            continue;
        }

        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let content = if size > 10 * 1024 * 1024 {
            use std::io::{BufRead, BufReader};
            let Some(file) = fs::File::open(entry.path()).ok() else {
                continue;
            };
            let reader = BufReader::new(file);
            let mut lines: Vec<String> = reader.lines().take(5000).flatten().collect();
            lines.push(format!(
                "\n--- [WARNING: File size is {:.2}MB, which exceeds the 10MB limit. Loaded first 5000 lines only] ---",
                size as f64 / (1024.0 * 1024.0)
            ));
            lines.join("\n")
        } else {
            let Some(content) = fs::read_to_string(entry.path()).ok() else {
                continue;
            };
            content
        };

        if !regex.is_match(&content) {
            continue;
        }
        let relative_path = entry
            .path()
            .strip_prefix(&access.path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .into_owned();

        match mode.as_str() {
            "files_with_matches" => files_with_matches.push(relative_path),
            "count" => total_matches += regex.find_iter(&content).count(),
            "content" => {
                for (index, line) in content.lines().enumerate() {
                    if regex.is_match(line) {
                        content_results.push(GrepContentResult {
                            file: relative_path.clone(),
                            line: index + 1,
                            content: line.to_string(),
                        });
                        if content_results.len() >= 1000 {
                            return Ok(GrepResult::Content(content_results));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    match mode.as_str() {
        "files_with_matches" => Ok(GrepResult::FilesWithMatches(files_with_matches)),
        "count" => Ok(GrepResult::Count(total_matches)),
        _ => Ok(GrepResult::Content(content_results)),
    }
}

#[tauri::command]
pub async fn project_glob(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    run_token: String,
    path: String,
    pattern: String,
    worktree_path: Option<String>,
) -> Result<Vec<String>, AppError> {
    let access = get_and_validate_project(
        &state,
        &project_id,
        &run_token,
        &path,
        "read",
        worktree_path.as_deref(),
    )?;
    tokio::task::spawn_blocking(move || glob_project_files(access, &pattern))
        .await
        .map_err(|e| AppError::AppPath(format!("Failed to join thread: {}", e)))?
}

fn glob_project_files(
    access: ValidatedProjectAccess,
    pattern: &str,
) -> Result<Vec<String>, AppError> {
    if !access.path.exists() || !access.path.is_dir() {
        return Err(AppError::AppPath(format!(
            "Directory does not exist: {}",
            access.path.display()
        )));
    }

    let mut builder = ignore::overrides::OverrideBuilder::new(&access.path);
    builder
        .add(pattern)
        .map_err(|e| AppError::AppPath(format!("Invalid glob pattern: {e}")))?;
    let overrides = builder
        .build()
        .map_err(|e| AppError::AppPath(format!("Failed to build overrides: {e}")))?;

    let traversal_exclusions = access.exclusions.clone();
    let mut walk_builder = ignore::WalkBuilder::new(&access.path);
    walk_builder
        .hidden(false)
        .git_ignore(true)
        .overrides(overrides)
        .filter_entry(move |entry| {
            let is_dir = entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false);
            traversal_exclusions.allows_discovered_path(entry.path(), is_dir)
        });

    let mut results = Vec::new();
    for entry in walk_builder.build().flatten() {
        if entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
            && access
                .exclusions
                .allows_discovered_path(entry.path(), false)
        {
            let relative_path = entry
                .path()
                .strip_prefix(&access.path)
                .unwrap_or(entry.path());
            results.push(relative_path.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{
        command_confirmation_authorized, glob_project_files, grep_project_files,
        list_project_directory, GrepResult, ValidatedProjectAccess,
    };
    use crate::project::{Project, ProjectExclusions, ProjectPermission};
    use std::path::{Path, PathBuf};

    fn fixture() -> (PathBuf, Project) {
        let root = std::env::temp_dir().join(format!("sythoria-walkers-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("node_modules/pkg")).expect("create node_modules");
        std::fs::create_dir_all(root.join("nested/.git")).expect("create git directory");
        std::fs::write(
            root.join("node_modules/pkg/secret.txt"),
            "MATCH hidden dependency",
        )
        .expect("write dependency file");
        std::fs::write(root.join("nested/.git/config"), "MATCH hidden git metadata")
            .expect("write git file");
        std::fs::write(root.join("nested/.env"), "MATCH hidden environment")
            .expect("write env file");
        std::fs::write(root.join("visible.txt"), "MATCH visible").expect("write visible file");
        std::fs::write(root.join("nested/visible.md"), "visible markdown")
            .expect("write visible nested file");

        let project = Project {
            id: "project".to_string(),
            name: "Project".to_string(),
            path: root.to_string_lossy().into_owned(),
            permissions: ProjectPermission::Read,
            skip_command_confirmations: None,
            exclude_patterns: Some(vec!["node_modules".into(), ".git".into(), ".env".into()]),
            system_prompt_override: None,
            model_override: None,
            is_auto_commit_enabled: None,
            auto_commit_msg_template: None,
        };
        (root, project)
    }

    fn access(project: &Project, path: &Path) -> ValidatedProjectAccess {
        let root = Path::new(&project.path)
            .canonicalize()
            .expect("canonical project root");
        ValidatedProjectAccess {
            path: path.canonicalize().expect("canonical access path"),
            exclusions: ProjectExclusions::new(project, &root).expect("compile exclusions"),
        }
    }

    #[test]
    fn shell_commands_require_acknowledgement_unless_the_project_opts_out() {
        let (root, mut project) = fixture();
        project.permissions = ProjectPermission::Full;

        assert!(!command_confirmation_authorized(&project, false));
        assert!(command_confirmation_authorized(&project, true));

        project.skip_command_confirmations = Some(true);
        assert!(command_confirmation_authorized(&project, false));
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn list_directory_hides_excluded_entries() {
        let (root, project) = fixture();

        let root_entries =
            list_project_directory(access(&project, &root)).expect("list project root");
        let nested_entries = list_project_directory(access(&project, &root.join("nested")))
            .expect("list nested directory");

        assert_eq!(root_entries, vec!["nested/", "visible.txt"]);
        assert_eq!(nested_entries, vec!["visible.md"]);
        std::fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[test]
    fn grep_does_not_read_excluded_files() {
        let (root, project) = fixture();

        let result = grep_project_files(
            access(&project, &root),
            "MATCH",
            Some("files_with_matches".to_string()),
            Some(false),
        )
        .expect("grep project");

        let GrepResult::FilesWithMatches(files) = result else {
            panic!("unexpected grep result mode");
        };
        assert_eq!(files, vec!["visible.txt"]);
        std::fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[test]
    fn glob_does_not_return_excluded_files() {
        let (root, project) = fixture();

        let mut results =
            glob_project_files(access(&project, &root), "**/*").expect("glob project");
        results.sort();

        assert_eq!(results, vec!["nested/visible.md", "visible.txt"]);
        std::fs::remove_dir_all(&root).expect("remove fixture");
    }
}

#[tauri::command]
pub async fn create_project_dir(app: AppHandle, name: String) -> Result<String, AppError> {
    let doc_dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::AppPath(format!("Failed to get document directory: {}", e)))?;

    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let safe_name = safe_name.trim().to_string();
    if safe_name.is_empty() {
        return Err(AppError::AppPath(
            "Project name cannot be empty".to_string(),
        ));
    }

    let project_path = doc_dir.join(safe_name);
    fs::create_dir_all(&project_path)
        .map_err(|e| AppError::AppPath(format!("Failed to create project directory: {}", e)))?;

    Ok(project_path.to_string_lossy().to_string())
}
