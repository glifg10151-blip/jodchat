use crate::atomic_file::write_atomic;
use crate::keyring::{delete_secret, get_secret, set_secret};
use crate::AppError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::{aead, hmac, rand};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use zeroize::Zeroize;

const ENVELOPE_MAGIC: &[u8; 7] = b"SYTHENC";
const STORAGE_VERSION: u8 = 1;
const DOCUMENT_SCHEMA_VERSION: u8 = 1;
const DOCUMENT_FORMAT: &str = "sythoria-settings";
const NONCE_LENGTH: usize = 12;
const MASTER_KEY_LENGTH: usize = 32;
const MAX_SETTINGS_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PREFERENCE_KEYS: usize = 4096;
const MAX_PREFERENCE_KEY_BYTES: usize = 256;
const KEYCHAIN_NAMESPACE: &str = "storage";
const KEYCHAIN_KEY_ID: &str = "settings-master-v1";
const CONVERSATION_ENCRYPTION_CONTEXT: &[u8] = b"sythoria:conversations:encryption:key:v2";
const CONVERSATION_CONTENT_HASH_CONTEXT: &[u8] = b"sythoria:conversations:content-hash:key:v2";

static STORAGE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static MASTER_KEY_CACHE: LazyLock<Mutex<Option<[u8; MASTER_KEY_LENGTH]>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsDocument<'a, T> {
    format: &'static str,
    schema_version: u8,
    value: &'a T,
}

#[derive(Clone, Copy, Debug)]
pub enum StorageDomain {
    Preferences,
    Models,
    Network,
    Search,
    Mcp,
    Projects,
    Secrets,
}

impl StorageDomain {
    pub const ALL: [Self; 7] = [
        Self::Preferences,
        Self::Models,
        Self::Network,
        Self::Search,
        Self::Mcp,
        Self::Projects,
        Self::Secrets,
    ];

    fn encrypted_filename(self) -> &'static str {
        match self {
            Self::Preferences => "preferences.enc",
            Self::Models => "models.enc",
            Self::Network => "network.enc",
            Self::Search => "search.enc",
            Self::Mcp => "mcp.enc",
            Self::Projects => "projects.enc",
            Self::Secrets => "secrets.enc",
        }
    }

    fn legacy_filename(self) -> Option<&'static str> {
        match self {
            Self::Preferences => Some("sythoria-store.json"),
            Self::Models => Some("config.json"),
            Self::Network => Some("network_config.json"),
            Self::Search => Some("search_config.json"),
            Self::Mcp => Some("mcp_config.json"),
            Self::Projects => Some("projects.json"),
            // Credentials only migrate from native legacy vault entries. Never
            // accept a plaintext file as a source for persisted secrets.
            Self::Secrets => None,
        }
    }

    fn key_context(self) -> &'static [u8] {
        match self {
            Self::Preferences => b"sythoria:settings:preferences:key:v1",
            Self::Models => b"sythoria:settings:models:key:v1",
            Self::Network => b"sythoria:settings:network:key:v1",
            Self::Search => b"sythoria:settings:search:key:v1",
            Self::Mcp => b"sythoria:settings:mcp:key:v1",
            Self::Projects => b"sythoria:settings:projects:key:v1",
            Self::Secrets => b"sythoria:settings:secrets:key:v1",
        }
    }

    fn aad(self) -> &'static [u8] {
        match self {
            Self::Preferences => b"sythoria:settings:preferences:file:v1",
            Self::Models => b"sythoria:settings:models:file:v1",
            Self::Network => b"sythoria:settings:network:file:v1",
            Self::Search => b"sythoria:settings:search:file:v1",
            Self::Mcp => b"sythoria:settings:mcp:file:v1",
            Self::Projects => b"sythoria:settings:projects:file:v1",
            Self::Secrets => b"sythoria:settings:secrets:file:v1",
        }
    }
}

struct DomainKey([u8; 32]);

impl Drop for DomainKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

fn app_data_directory(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(error.to_string()))
}

fn encrypted_path(app_data_dir: &Path, domain: StorageDomain) -> PathBuf {
    app_data_dir.join(domain.encrypted_filename())
}

fn legacy_path(app_data_dir: &Path, domain: StorageDomain) -> Option<PathBuf> {
    domain
        .legacy_filename()
        .map(|filename| app_data_dir.join(filename))
}

fn any_encrypted_settings_exist(app_data_dir: &Path) -> bool {
    StorageDomain::ALL
        .iter()
        .any(|domain| encrypted_path(app_data_dir, *domain).exists())
        || app_data_dir
            .join("conversations")
            .join("manifest.enc")
            .exists()
}

fn load_or_create_master(app_data_dir: &Path) -> Result<[u8; MASTER_KEY_LENGTH], AppError> {
    let mut cache = MASTER_KEY_CACHE
        .lock()
        .map_err(|_| AppError::ConfigIo("Root key cache lock is poisoned".to_string()))?;
    if let Some(master) = *cache {
        return Ok(master);
    }

    let master = match get_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID) {
        Ok(mut encoded) => {
            let decoded = BASE64.decode(&encoded);
            encoded.zeroize();
            let mut decoded = decoded.map_err(|_| {
                AppError::ConfigIo("Root encryption key is not valid base64".to_string())
            })?;
            if decoded.len() != MASTER_KEY_LENGTH {
                decoded.zeroize();
                return Err(AppError::ConfigIo(
                    "Root encryption key has an invalid length".to_string(),
                ));
            }
            let mut master = [0_u8; MASTER_KEY_LENGTH];
            master.copy_from_slice(&decoded);
            decoded.zeroize();
            master
        }
        Err(AppError::KeyNotFound(_)) => {
            if any_encrypted_settings_exist(app_data_dir) {
                return Err(AppError::ConfigIo(
                    "Encrypted application data exists, but its root key is missing from the OS credential vault"
                        .to_string(),
                ));
            }

            let random = rand::SystemRandom::new();
            let mut master = [0_u8; MASTER_KEY_LENGTH];
            rand::SecureRandom::fill(&random, &mut master).map_err(|_| {
                AppError::ConfigIo("Failed to generate root encryption key".to_string())
            })?;
            let mut encoded = BASE64.encode(master);
            let save_result = set_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID, &encoded);
            encoded.zeroize();
            if let Err(error) = save_result {
                master.zeroize();
                return Err(error);
            }
            master
        }
        Err(error) => return Err(error),
    };
    *cache = Some(master);
    Ok(master)
}

fn derive_context_key(master: &[u8; MASTER_KEY_LENGTH], context: &[u8]) -> [u8; 32] {
    let key = hmac::Key::new(hmac::HMAC_SHA256, master);
    let tag = hmac::sign(&key, context);
    let mut derived = [0_u8; 32];
    derived.copy_from_slice(tag.as_ref());
    derived
}

fn derive_domain_key(master: &[u8; MASTER_KEY_LENGTH], domain: StorageDomain) -> DomainKey {
    DomainKey(derive_context_key(master, domain.key_context()))
}

pub(crate) fn derive_conversation_keys(
    app: &tauri::AppHandle,
) -> Result<([u8; 32], [u8; 32]), AppError> {
    let app_data_dir = app_data_directory(app)?;
    let mut master = load_or_create_master(&app_data_dir)?;
    let encryption = derive_context_key(&master, CONVERSATION_ENCRYPTION_CONTEXT);
    let content_hash = derive_context_key(&master, CONVERSATION_CONTENT_HASH_CONTEXT);
    master.zeroize();
    Ok((encryption, content_hash))
}

fn encrypt(plaintext: &[u8], domain: StorageDomain, key: &DomainKey) -> Result<Vec<u8>, AppError> {
    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, &key.0)
        .map_err(|_| AppError::ConfigIo("Failed to initialize settings encryption".to_string()))?;
    let key = aead::LessSafeKey::new(unbound_key);

    let random = rand::SystemRandom::new();
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    rand::SecureRandom::fill(&random, &mut nonce_bytes).map_err(|_| {
        AppError::ConfigIo("Failed to generate settings encryption nonce".to_string())
    })?;

    let mut ciphertext = plaintext.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce_bytes),
        aead::Aad::from(domain.aad()),
        &mut ciphertext,
    )
    .map_err(|_| AppError::ConfigIo("Failed to encrypt settings".to_string()))?;

    let mut envelope =
        Vec::with_capacity(ENVELOPE_MAGIC.len() + 1 + NONCE_LENGTH + ciphertext.len());
    envelope.extend_from_slice(ENVELOPE_MAGIC);
    envelope.push(STORAGE_VERSION);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

fn decrypt(envelope: &[u8], domain: StorageDomain, key: &DomainKey) -> Result<Vec<u8>, AppError> {
    let header_length = ENVELOPE_MAGIC.len() + 1 + NONCE_LENGTH;
    if envelope.len() < header_length + aead::AES_256_GCM.tag_len()
        || &envelope[..ENVELOPE_MAGIC.len()] != ENVELOPE_MAGIC
        || envelope[ENVELOPE_MAGIC.len()] != STORAGE_VERSION
    {
        return Err(AppError::ConfigIo(format!(
            "Encrypted {} has an unsupported or corrupted header",
            domain.encrypted_filename()
        )));
    }

    let nonce_start = ENVELOPE_MAGIC.len() + 1;
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    nonce_bytes.copy_from_slice(&envelope[nonce_start..nonce_start + NONCE_LENGTH]);

    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, &key.0)
        .map_err(|_| AppError::ConfigIo("Failed to initialize settings decryption".to_string()))?;
    let key = aead::LessSafeKey::new(unbound_key);
    let mut ciphertext = envelope[header_length..].to_vec();
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce_bytes),
            aead::Aad::from(domain.aad()),
            &mut ciphertext,
        )
        .map_err(|_| {
            AppError::ConfigIo(format!(
                "Encrypted {} failed authentication; it may have been modified or corrupted",
                domain.encrypted_filename()
            ))
        })?;
    let plaintext = plaintext.to_vec();
    ciphertext.zeroize();
    Ok(plaintext)
}

fn save_json_locked<T: Serialize>(
    app_data_dir: &Path,
    domain: StorageDomain,
    value: &T,
) -> Result<(), AppError> {
    let mut master = load_or_create_master(app_data_dir)?;
    let key = derive_domain_key(&master, domain);
    master.zeroize();
    let document = SettingsDocument {
        format: DOCUMENT_FORMAT,
        schema_version: DOCUMENT_SCHEMA_VERSION,
        value,
    };
    let mut plaintext =
        serde_json::to_vec(&document).map_err(|error| AppError::ParseError(error.to_string()))?;
    if plaintext.len() > MAX_SETTINGS_FILE_BYTES {
        plaintext.zeroize();
        return Err(AppError::ConfigIo(format!(
            "{} exceeds the encrypted settings size limit",
            domain.encrypted_filename()
        )));
    }
    let encrypted = encrypt(&plaintext, domain, &key);
    plaintext.zeroize();
    let encrypted = encrypted?;
    write_atomic(&encrypted_path(app_data_dir, domain), &encrypted)?;
    Ok(())
}

fn load_json_locked<T: DeserializeOwned + Serialize>(
    app_data_dir: &Path,
    domain: StorageDomain,
) -> Result<Option<T>, AppError> {
    let encrypted = encrypted_path(app_data_dir, domain);
    let legacy = legacy_path(app_data_dir, domain);

    if encrypted.exists() {
        let mut master = load_or_create_master(app_data_dir)?;
        let key = derive_domain_key(&master, domain);
        master.zeroize();
        let envelope = fs::read(&encrypted)?;
        if envelope.len() > MAX_SETTINGS_FILE_BYTES + 64 {
            return Err(AppError::ConfigIo(format!(
                "{} exceeds the encrypted settings size limit",
                domain.encrypted_filename()
            )));
        }
        let mut plaintext = decrypt(&envelope, domain, &key)?;
        let parsed = serde_json::from_slice::<serde_json::Value>(&plaintext)
            .map_err(|error| AppError::ParseError(error.to_string()));
        plaintext.zeroize();
        let parsed = parsed?;
        let (value, needs_schema_migration) = match parsed {
            serde_json::Value::Object(mut object)
                if object.get("format").and_then(serde_json::Value::as_str)
                    == Some(DOCUMENT_FORMAT)
                    && object.contains_key("schemaVersion")
                    && object.contains_key("value") =>
            {
                let schema_version = object
                    .remove("schemaVersion")
                    .and_then(|value| value.as_u64())
                    .ok_or_else(|| {
                        AppError::ParseError(
                            "Encrypted settings schema version is invalid".to_string(),
                        )
                    })?;
                if schema_version != u64::from(DOCUMENT_SCHEMA_VERSION) {
                    return Err(AppError::ConfigIo(format!(
                        "Unsupported {} schema version {schema_version}",
                        domain.encrypted_filename()
                    )));
                }
                let value = object.remove("value").ok_or_else(|| {
                    AppError::ParseError("Encrypted settings document has no value".to_string())
                })?;
                (
                    serde_json::from_value(value)
                        .map_err(|error| AppError::ParseError(error.to_string()))?,
                    false,
                )
            }
            legacy_value => (
                serde_json::from_value(legacy_value)
                    .map_err(|error| AppError::ParseError(error.to_string()))?,
                true,
            ),
        };
        if needs_schema_migration {
            save_json_locked(app_data_dir, domain, &value)?;
        }
        if legacy.as_ref().is_some_and(|path| path.exists()) {
            let legacy = legacy.expect("legacy path was checked");
            fs::remove_file(&legacy).map_err(|error| {
                AppError::ConfigIo(format!(
                    "Encrypted settings loaded, but legacy plaintext {} could not be removed: {error}",
                    legacy.display()
                ))
            })?;
        }
        return Ok(Some(value));
    }

    let Some(legacy) = legacy else {
        return Ok(None);
    };
    if !legacy.exists() {
        return Ok(None);
    }

    let mut plaintext = fs::read(&legacy)?;
    if plaintext.len() > MAX_SETTINGS_FILE_BYTES {
        plaintext.zeroize();
        return Err(AppError::ConfigIo(format!(
            "{} exceeds the settings migration size limit",
            legacy.display()
        )));
    }
    let value =
        serde_json::from_slice(&plaintext).map_err(|error| AppError::ParseError(error.to_string()));
    plaintext.zeroize();
    let value: T = value?;
    save_json_locked(app_data_dir, domain, &value)?;
    fs::remove_file(&legacy).map_err(|error| {
        AppError::ConfigIo(format!(
            "Settings were encrypted, but legacy plaintext {} could not be removed: {error}",
            legacy.display()
        ))
    })?;
    Ok(Some(value))
}

pub fn load_json<T: DeserializeOwned + Serialize>(
    app: &tauri::AppHandle,
    domain: StorageDomain,
) -> Result<Option<T>, AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Settings storage lock is poisoned".to_string()))?;
    load_json_locked(&app_data_directory(app)?, domain)
}

pub fn save_json<T: Serialize>(
    app: &tauri::AppHandle,
    domain: StorageDomain,
    value: &T,
) -> Result<(), AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Settings storage lock is poisoned".to_string()))?;
    save_json_locked(&app_data_directory(app)?, domain, value)
}

pub fn domain_file_exists(app: &tauri::AppHandle, domain: StorageDomain) -> Result<bool, AppError> {
    let app_data_dir = app_data_directory(app)?;
    Ok(encrypted_path(&app_data_dir, domain).exists()
        || legacy_path(&app_data_dir, domain).is_some_and(|path| path.exists()))
}

pub fn mutate_preferences(
    app: &tauri::AppHandle,
    sets: serde_json::Map<String, serde_json::Value>,
    deletes: &[String],
    clear: bool,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Settings storage lock is poisoned".to_string()))?;
    let app_data_dir = app_data_directory(app)?;
    let mut preferences: serde_json::Map<String, serde_json::Value> =
        load_json_locked(&app_data_dir, StorageDomain::Preferences)?.unwrap_or_default();
    if clear {
        preferences.clear();
    }
    if sets
        .keys()
        .chain(deletes.iter())
        .any(|key| key.len() > MAX_PREFERENCE_KEY_BYTES)
    {
        return Err(AppError::ParseError(
            "Preference key exceeds the maximum length".to_string(),
        ));
    }
    for key in deletes {
        preferences.remove(key);
    }
    preferences.extend(sets);
    if preferences.len() > MAX_PREFERENCE_KEYS {
        return Err(AppError::ConfigIo(
            "Encrypted preferences exceed the maximum key count".to_string(),
        ));
    }
    save_json_locked(&app_data_dir, StorageDomain::Preferences, &preferences)?;
    Ok(preferences)
}

pub fn load_preferences(
    app: &tauri::AppHandle,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    load_json(app, StorageDomain::Preferences).map(|value| value.unwrap_or_default())
}

pub fn get_preference(
    app: &tauri::AppHandle,
    key: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    Ok(load_preferences(app)?.remove(key))
}

pub fn set_preference(
    app: &tauri::AppHandle,
    key: &str,
    value: serde_json::Value,
) -> Result<(), AppError> {
    let mut sets = serde_json::Map::new();
    sets.insert(key.to_string(), value);
    mutate_preferences(app, sets, &[], false).map(|_| ())
}

pub fn remove_all_settings_files(app: &tauri::AppHandle) -> Result<(), AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Settings storage lock is poisoned".to_string()))?;
    let app_data_dir = app_data_directory(app)?;
    let mut failures = Vec::new();
    for domain in StorageDomain::ALL {
        let mut paths = vec![encrypted_path(&app_data_dir, domain)];
        paths.extend(legacy_path(&app_data_dir, domain));
        for path in paths {
            if path.exists() {
                if let Err(error) = fs::remove_file(&path) {
                    failures.push(format!("Failed to remove {}: {error}", path.display()));
                }
            }
        }
    }
    if let Ok(config_dir) = app.path().app_config_dir() {
        let legacy_window_state = config_dir.join(".window-state.json");
        if legacy_window_state.exists() {
            if let Err(error) = fs::remove_file(&legacy_window_state) {
                failures.push(format!(
                    "Failed to remove {}: {error}",
                    legacy_window_state.display()
                ));
            }
        }
    }
    if let Ok(log_dir) = app.path().app_log_dir() {
        if log_dir.exists() {
            if let Err(error) = fs::remove_dir_all(&log_dir) {
                failures.push(format!("Failed to remove {}: {error}", log_dir.display()));
            }
        }
    }
    if !failures.is_empty() {
        return Err(AppError::ConfigIo(failures.join("; ")));
    }
    let mut cache = MASTER_KEY_CACHE
        .lock()
        .map_err(|_| AppError::ConfigIo("Root key cache lock is poisoned".to_string()))?;
    if let Some(mut master) = cache.take() {
        master.zeroize();
    }
    drop(cache);
    delete_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID)
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt, derive_context_key, derive_domain_key, encrypt, DomainKey, StorageDomain,
        CONVERSATION_CONTENT_HASH_CONTEXT, CONVERSATION_ENCRYPTION_CONTEXT,
    };

    #[test]
    fn encrypted_settings_roundtrip_without_plaintext() {
        let master = [7_u8; 32];
        let key = derive_domain_key(&master, StorageDomain::Network);
        let plaintext = br#"{"strict_ssl":true,"offline_mode":false}"#;

        let encrypted = encrypt(plaintext, StorageDomain::Network, &key).expect("encrypt");
        assert!(!encrypted
            .windows(plaintext.len())
            .any(|window| window == plaintext));
        assert_eq!(
            decrypt(&encrypted, StorageDomain::Network, &key).expect("decrypt"),
            plaintext
        );
    }

    #[test]
    fn domain_binding_rejects_cross_domain_decryption() {
        let key = DomainKey([9_u8; 32]);
        let encrypted = encrypt(b"settings", StorageDomain::Models, &key).expect("encrypt");
        assert!(decrypt(&encrypted, StorageDomain::Projects, &key).is_err());
    }

    #[test]
    fn one_root_derives_independent_storage_keys() {
        let master = [13_u8; 32];
        let settings = derive_domain_key(&master, StorageDomain::Secrets);
        let conversation_encryption = derive_context_key(&master, CONVERSATION_ENCRYPTION_CONTEXT);
        let conversation_hash = derive_context_key(&master, CONVERSATION_CONTENT_HASH_CONTEXT);

        assert_ne!(settings.0, conversation_encryption);
        assert_ne!(settings.0, conversation_hash);
        assert_ne!(conversation_encryption, conversation_hash);
    }

    #[test]
    fn encrypted_secret_domain_does_not_expose_credentials() {
        assert_eq!(StorageDomain::Secrets.legacy_filename(), None);
        let master = [23_u8; 32];
        let key = derive_domain_key(&master, StorageDomain::Secrets);
        let plaintext = br#"{"modelApiKeys":{"provider":"sk-sensitive"}}"#;

        let encrypted = encrypt(plaintext, StorageDomain::Secrets, &key).expect("encrypt secrets");

        assert!(!encrypted
            .windows(b"sk-sensitive".len())
            .any(|window| window == b"sk-sensitive"));
        assert_eq!(
            decrypt(&encrypted, StorageDomain::Secrets, &key).expect("decrypt secrets"),
            plaintext
        );
    }

    #[test]
    fn tampering_is_rejected() {
        let key = DomainKey([11_u8; 32]);
        let mut encrypted = encrypt(b"settings", StorageDomain::Search, &key).expect("encrypt");
        let last = encrypted.last_mut().expect("ciphertext byte");
        *last ^= 0x80;
        assert!(decrypt(&encrypted, StorageDomain::Search, &key).is_err());
    }
}
