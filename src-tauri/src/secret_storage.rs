use crate::keyring;
use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use zeroize::Zeroize;

pub(crate) const STORED_SECRET_PLACEHOLDER: &str = "••••••••••••";

const API_KEY_INDEX: &str = "sythoria-api-key-index";
const SEARCH_API_KEY_INDEX: &str = "sythoria-search-api-key-index";
const MCP_ENV_KEY_INDEX: &str = "sythoria-mcp-env-key-index";
const MCP_API_KEY_INDEX: &str = "sythoria-mcp-api-key-index";
const CLOUD_STT_NAMESPACE: &str = "whisper";
const CLOUD_STT_KEY_ID: &str = "cloud-stt";
const NETWORK_POLICY_NAMESPACE: &str = "storage-state";
const NETWORK_POLICY_KEY_ID: &str = "network-policy-v1";
pub(crate) const GOOGLE_OAUTH_GRANT_ENV: &str = "SYTHORIA_GOOGLE_OAUTH_GRANT";
pub(crate) const GOOGLE_OAUTH_KIND_ENV: &str = "SYTHORIA_GOOGLE_OAUTH_KIND";
const MAX_SECRET_MAP_ENTRIES: usize = 4096;
const MAX_SECRET_ID_BYTES: usize = 512;
const MAX_SECRET_VALUE_BYTES: usize = 1024 * 1024;

static SECRET_STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static LEGACY_CLEANUP_ATTEMPTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCredential {
    namespace: String,
    id: String,
}

impl LegacyCredential {
    fn new(namespace: &str, id: &str) -> Self {
        Self {
            namespace: namespace.to_string(),
            id: id.to_string(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct GoogleOAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

impl Drop for GoogleOAuthClient {
    fn drop(&mut self) {
        self.client_secret.zeroize();
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct GoogleOAuthGrant {
    pub client_id: String,
    pub client_secret: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expiry_date: Option<i64>,
    pub scope: Option<String>,
}

impl Drop for GoogleOAuthGrant {
    fn drop(&mut self) {
        self.client_secret.zeroize();
        self.access_token.zeroize();
        if let Some(refresh_token) = self.refresh_token.as_mut() {
            refresh_token.zeroize();
        }
    }
}

pub(crate) fn get_google_oauth_client(
    app: &tauri::AppHandle,
) -> Result<Option<GoogleOAuthClient>, AppError> {
    let _guard = lock_store()?;
    let mut secrets = load_locked(app)?;
    if secrets.google_oauth_client.is_none() {
        // Recover only an unambiguous, complete legacy pair. Never guess which app a secret belongs to.
        let pairs: HashSet<(String, String)> = secrets
            .mcp_env
            .values()
            .filter_map(|env| {
                let id = env.get("GOOGLE_CLIENT_ID")?;
                let secret = env.get("GOOGLE_CLIENT_SECRET")?;
                if id.ends_with(".apps.googleusercontent.com")
                    && !secret.is_empty()
                    && secret != STORED_SECRET_PLACEHOLDER
                {
                    Some((id.clone(), secret.clone()))
                } else {
                    None
                }
            })
            .collect();
        if pairs.len() == 1 {
            let (client_id, client_secret) = pairs.into_iter().next().unwrap();
            secrets.google_oauth_client = Some(GoogleOAuthClient {
                client_id,
                client_secret,
            });
            secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
        }
    }
    Ok(secrets.google_oauth_client.clone())
}

pub(crate) fn save_google_oauth_client(
    app: &tauri::AppHandle,
    client: GoogleOAuthClient,
) -> Result<(), AppError> {
    if !client.client_id.ends_with(".apps.googleusercontent.com")
        || client.client_secret.trim().is_empty()
        || client.client_secret == STORED_SECRET_PLACEHOLDER
        || client.client_secret.len() > 4096
        || client.client_id.len() > 512
    {
        return Err(AppError::RequestFailed(
            "Enter the matching client ID and secret from a Google Desktop app credentials file."
                .into(),
        ));
    }
    let _guard = lock_store()?;
    let mut secrets = load_locked(app)?;
    secrets.google_oauth_client = Some(client);
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn save_google_oauth_grant(
    app: &tauri::AppHandle,
    grant: GoogleOAuthGrant,
) -> Result<String, AppError> {
    if !grant.client_id.ends_with(".apps.googleusercontent.com")
        || grant.client_secret.trim().is_empty()
        || grant.access_token.trim().is_empty()
        || grant.client_id.len() > 512
        || grant.client_secret.len() > 4096
        || grant.access_token.len() > MAX_SECRET_VALUE_BYTES
        || grant
            .refresh_token
            .as_ref()
            .is_some_and(|token| token.len() > MAX_SECRET_VALUE_BYTES)
    {
        return Err(AppError::RequestFailed(
            "Google returned an invalid OAuth grant. Authorize the plugin again.".into(),
        ));
    }

    let _guard = lock_store()?;
    let mut secrets = load_locked(app)?;
    if secrets.google_oauth_grants.len() >= MAX_SECRET_MAP_ENTRIES {
        return Err(AppError::ConfigIo(
            "Too many saved Google authorization grants".into(),
        ));
    }
    let grant_id = uuid::Uuid::new_v4().to_string();
    secrets.google_oauth_grants.insert(grant_id.clone(), grant);
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
    Ok(grant_id)
}

pub(crate) fn get_google_oauth_grant(
    app: &tauri::AppHandle,
    grant_id: &str,
) -> Result<Option<GoogleOAuthGrant>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.google_oauth_grants.get(grant_id).cloned())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSecrets {
    #[serde(default)]
    model_api_keys: HashMap<String, String>,
    #[serde(default)]
    search_api_keys: HashMap<String, String>,
    #[serde(default)]
    mcp_api_keys: HashMap<String, String>,
    #[serde(default)]
    mcp_env: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    cloud_stt_api_key: Option<String>,
    #[serde(default)]
    google_oauth_client: Option<GoogleOAuthClient>,
    #[serde(default)]
    google_oauth_grants: HashMap<String, GoogleOAuthGrant>,
    #[serde(default)]
    network_policy_initialized: bool,
    #[serde(default)]
    legacy_cleanup_pending: Vec<LegacyCredential>,
}

impl Drop for NativeSecrets {
    fn drop(&mut self) {
        zeroize_map(&mut self.model_api_keys);
        zeroize_map(&mut self.search_api_keys);
        zeroize_map(&mut self.mcp_api_keys);
        for env in self.mcp_env.values_mut() {
            zeroize_map(env);
        }
        self.mcp_env.clear();
        if let Some(secret) = self.cloud_stt_api_key.as_mut() {
            secret.zeroize();
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum SecretMapKind {
    Model,
    Search,
    Mcp,
}

fn map_for_kind(secrets: &NativeSecrets, kind: SecretMapKind) -> &HashMap<String, String> {
    match kind {
        SecretMapKind::Model => &secrets.model_api_keys,
        SecretMapKind::Search => &secrets.search_api_keys,
        SecretMapKind::Mcp => &secrets.mcp_api_keys,
    }
}

fn map_for_kind_mut(
    secrets: &mut NativeSecrets,
    kind: SecretMapKind,
) -> &mut HashMap<String, String> {
    match kind {
        SecretMapKind::Model => &mut secrets.model_api_keys,
        SecretMapKind::Search => &mut secrets.search_api_keys,
        SecretMapKind::Mcp => &mut secrets.mcp_api_keys,
    }
}

fn zeroize_map(map: &mut HashMap<String, String>) {
    for value in map.values_mut() {
        value.zeroize();
    }
    map.clear();
}

fn zeroize_nested_map(map: &mut HashMap<String, HashMap<String, String>>) {
    for values in map.values_mut() {
        zeroize_map(values);
    }
    map.clear();
}

fn load_legacy_index(app: &tauri::AppHandle, index_key: &str) -> Result<Vec<String>, AppError> {
    let index = secure_storage::get_preference(app, index_key)?;
    Ok(index
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToString::to_string))
        .collect())
}

fn read_legacy_secret(
    namespace: &str,
    id: &str,
    cleanup: &mut Vec<LegacyCredential>,
) -> Result<Option<String>, AppError> {
    match keyring::get_secret(namespace, id) {
        Ok(secret) => {
            cleanup.push(LegacyCredential::new(namespace, id));
            Ok((!secret.is_empty()).then_some(secret))
        }
        Err(AppError::KeyNotFound(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

fn read_legacy_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
    cleanup: &mut Vec<LegacyCredential>,
) -> Result<HashMap<String, String>, AppError> {
    let mut result = HashMap::new();
    for id in load_legacy_index(app, index_key)? {
        match read_legacy_secret(namespace, &id, cleanup) {
            Ok(Some(secret)) => {
                result.insert(id, secret);
            }
            Ok(None) => {}
            Err(error) => {
                zeroize_map(&mut result);
                return Err(error);
            }
        }
    }
    Ok(result)
}

fn migrate_legacy_secrets(app: &tauri::AppHandle) -> Result<NativeSecrets, AppError> {
    let mut secrets = NativeSecrets::default();
    secrets.model_api_keys = read_legacy_map(
        app,
        "model",
        API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.search_api_keys = read_legacy_map(
        app,
        "search",
        SEARCH_API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.mcp_api_keys = read_legacy_map(
        app,
        "mcp",
        MCP_API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;

    for server_id in load_legacy_index(app, MCP_ENV_KEY_INDEX)? {
        let server_index_key = format!("mcp-env:{server_id}");
        let env_keys = load_legacy_index(app, &server_index_key)?;
        let mut server_env = HashMap::new();
        for env_key in env_keys {
            let legacy_id = format!("{server_id}:{env_key}");
            match read_legacy_secret("mcp-env", &legacy_id, &mut secrets.legacy_cleanup_pending) {
                Ok(Some(secret)) => {
                    server_env.insert(env_key, secret);
                }
                Ok(None) => {}
                Err(error) => {
                    zeroize_map(&mut server_env);
                    return Err(error);
                }
            }
        }
        if !server_env.is_empty() {
            secrets.mcp_env.insert(server_id, server_env);
        }
    }

    secrets.cloud_stt_api_key = read_legacy_secret(
        CLOUD_STT_NAMESPACE,
        CLOUD_STT_KEY_ID,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.network_policy_initialized = read_legacy_secret(
        NETWORK_POLICY_NAMESPACE,
        NETWORK_POLICY_KEY_ID,
        &mut secrets.legacy_cleanup_pending,
    )?
    .is_some();
    Ok(secrets)
}

fn try_cleanup_legacy(app: &tauri::AppHandle, secrets: &mut NativeSecrets) {
    if secrets.legacy_cleanup_pending.is_empty()
        || LEGACY_CLEANUP_ATTEMPTED.swap(true, Ordering::AcqRel)
    {
        return;
    }

    let mut failures = Vec::new();
    for credential in &secrets.legacy_cleanup_pending {
        if let Err(error) = keyring::delete_secret(&credential.namespace, &credential.id) {
            log::warn!(
                "Could not remove a migrated legacy Keychain credential ({}): {error}",
                credential.namespace
            );
            failures.push(credential.clone());
        }
    }

    secrets.legacy_cleanup_pending = failures;
    if let Err(error) = secure_storage::save_json(app, StorageDomain::Secrets, secrets) {
        log::warn!("Could not persist legacy credential cleanup state: {error}");
    }
}

fn load_locked(app: &tauri::AppHandle) -> Result<NativeSecrets, AppError> {
    let mut secrets = match secure_storage::load_json(app, StorageDomain::Secrets)? {
        Some(secrets) => secrets,
        None => {
            let secrets = migrate_legacy_secrets(app)?;
            // The encrypted, authenticated replacement must reach disk before any
            // legacy Keychain credential is deleted.
            secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
            secrets
        }
    };
    migrate_legacy_google_grants(app, &mut secrets)?;
    try_cleanup_legacy(app, &mut secrets);
    Ok(secrets)
}

fn google_grant_from_files(
    oauth_path: &str,
    token_path: &str,
    legacy_root: &std::path::Path,
) -> Option<(GoogleOAuthGrant, PathBuf)> {
    let canonical_root = std::fs::canonicalize(legacy_root).ok()?;
    let canonical_oauth = std::fs::canonicalize(oauth_path).ok()?;
    let canonical_token = std::fs::canonicalize(token_path).ok()?;
    let grant_dir = canonical_oauth.parent()?.to_path_buf();
    if canonical_token.parent()? != grant_dir || grant_dir.parent()? != canonical_root {
        return None;
    }

    let oauth: serde_json::Value =
        serde_json::from_slice(&std::fs::read(canonical_oauth).ok()?).ok()?;
    let client = oauth.get("installed").or_else(|| oauth.get("web"))?;
    let token: serde_json::Value =
        serde_json::from_slice(&std::fs::read(canonical_token).ok()?).ok()?;
    let client_id = client.get("client_id")?.as_str()?.trim().to_string();
    let client_secret = client.get("client_secret")?.as_str()?.trim().to_string();
    let access_token = token.get("access_token")?.as_str()?.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() || access_token.is_empty() {
        return None;
    }

    Some((
        GoogleOAuthGrant {
            client_id,
            client_secret,
            access_token,
            refresh_token: token
                .get("refresh_token")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string),
            expiry_date: token.get("expiry_date").and_then(serde_json::Value::as_i64),
            scope: token
                .get("scope")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string),
        },
        grant_dir,
    ))
}

fn cleanup_unreferenced_legacy_google_dirs(legacy_root: &std::path::Path, secrets: &NativeSecrets) {
    let Ok(canonical_root) = std::fs::canonicalize(legacy_root) else {
        return;
    };
    let referenced: HashSet<PathBuf> = secrets
        .mcp_env
        .values()
        .flat_map(|env| {
            [
                env.get("GMAIL_OAUTH_PATH"),
                env.get("GMAIL_CREDENTIALS_PATH"),
                env.get("GOOGLE_DRIVE_OAUTH_CREDENTIALS"),
                env.get("GOOGLE_DRIVE_MCP_TOKEN_PATH"),
            ]
            .into_iter()
            .flatten()
        })
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .filter_map(|path| path.parent().map(std::path::Path::to_path_buf))
        .filter(|directory| directory.parent() == Some(canonical_root.as_path()))
        .collect();

    let Ok(entries) = std::fs::read_dir(&canonical_root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(path) = std::fs::canonicalize(entry.path()) else {
            continue;
        };
        if path.is_dir()
            && path.parent() == Some(canonical_root.as_path())
            && !referenced.contains(&path)
        {
            if let Err(error) = std::fs::remove_dir_all(&path) {
                log::warn!(
                    "Could not remove unreferenced legacy Google credentials at {}: {error}",
                    path.display()
                );
            }
        }
    }
    if std::fs::read_dir(&canonical_root)
        .ok()
        .is_some_and(|mut entries| entries.next().is_none())
    {
        let _ = std::fs::remove_dir(&canonical_root);
    }
}

fn migrate_legacy_google_grants(
    app: &tauri::AppHandle,
    secrets: &mut NativeSecrets,
) -> Result<(), AppError> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(format!("Failed to get app data directory: {error}")))?;
    let legacy_root = app_dir.join("google-oauth");
    if !legacy_root.exists() {
        return Ok(());
    }

    let mut migrations = Vec::new();
    for (server_id, env) in &secrets.mcp_env {
        if env.contains_key(GOOGLE_OAUTH_GRANT_ENV) {
            continue;
        }
        let legacy = if let (Some(oauth), Some(credentials)) = (
            env.get("GMAIL_OAUTH_PATH"),
            env.get("GMAIL_CREDENTIALS_PATH"),
        ) {
            Some((oauth.as_str(), credentials.as_str(), "gmail"))
        } else if let (Some(oauth), Some(tokens)) = (
            env.get("GOOGLE_DRIVE_OAUTH_CREDENTIALS"),
            env.get("GOOGLE_DRIVE_MCP_TOKEN_PATH"),
        ) {
            Some((oauth.as_str(), tokens.as_str(), "workspace"))
        } else {
            None
        };
        let Some((oauth_path, token_path, kind)) = legacy else {
            continue;
        };
        let Some((grant, _grant_dir)) =
            google_grant_from_files(oauth_path, token_path, &legacy_root)
        else {
            continue;
        };
        migrations.push((
            server_id.clone(),
            uuid::Uuid::new_v4().to_string(),
            kind.to_string(),
            grant,
        ));
    }

    if migrations.is_empty() {
        cleanup_unreferenced_legacy_google_dirs(&legacy_root, secrets);
        return Ok(());
    }

    for (server_id, grant_id, kind, grant) in &migrations {
        secrets
            .google_oauth_grants
            .insert(grant_id.clone(), grant.clone());
        if let Some(env) = secrets.mcp_env.get_mut(server_id) {
            env.remove("GMAIL_OAUTH_PATH");
            env.remove("GMAIL_CREDENTIALS_PATH");
            env.remove("GOOGLE_DRIVE_OAUTH_CREDENTIALS");
            env.remove("GOOGLE_DRIVE_MCP_TOKEN_PATH");
            env.remove("GOOGLE_CLIENT_SECRET");
            env.insert(GOOGLE_OAUTH_GRANT_ENV.to_string(), grant_id.clone());
            env.insert(GOOGLE_OAUTH_KIND_ENV.to_string(), kind.clone());
        }
    }

    // Persist the encrypted replacement before removing any legacy cleartext file.
    secure_storage::save_json(app, StorageDomain::Secrets, secrets)?;
    cleanup_unreferenced_legacy_google_dirs(&legacy_root, secrets);
    Ok(())
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    SECRET_STORE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Secret store lock is poisoned".to_string()))
}

pub(crate) fn lock_for_wipe() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    lock_store()
}

fn validate_secret_map(map: &HashMap<String, String>, label: &str) -> Result<(), AppError> {
    if map.len() > MAX_SECRET_MAP_ENTRIES {
        return Err(AppError::ParseError(format!(
            "{label} contains too many entries"
        )));
    }
    for (id, value) in map {
        if id.is_empty() || id.len() > MAX_SECRET_ID_BYTES {
            return Err(AppError::ParseError(format!(
                "{label} contains an invalid identifier"
            )));
        }
        if value.len() > MAX_SECRET_VALUE_BYTES {
            return Err(AppError::ParseError(format!(
                "{label} contains a value that exceeds the size limit"
            )));
        }
    }
    Ok(())
}

fn validate_placeholders(
    existing: &HashMap<String, String>,
    incoming: &HashMap<String, String>,
    label: &str,
) -> Result<(), AppError> {
    if incoming
        .iter()
        .any(|(id, value)| value == STORED_SECRET_PLACEHOLDER && !existing.contains_key(id))
    {
        return Err(AppError::ParseError(format!(
            "{label} contains a placeholder without an existing encrypted secret"
        )));
    }
    Ok(())
}

fn replace_map(existing: &mut HashMap<String, String>, mut incoming: HashMap<String, String>) {
    let mut previous = std::mem::take(existing);
    let mut replacement = HashMap::with_capacity(incoming.len());
    for (id, mut value) in incoming.drain() {
        if value.is_empty() {
            value.zeroize();
        } else if value == STORED_SECRET_PLACEHOLDER {
            value.zeroize();
            if let Some(secret) = previous.remove(&id) {
                replacement.insert(id, secret);
            }
        } else {
            replacement.insert(id, value);
        }
    }
    zeroize_map(&mut previous);
    *existing = replacement;
}

pub(crate) fn load_masked_map(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
) -> Result<serde_json::Value, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    let masked = map_for_kind(&secrets, kind)
        .keys()
        .map(|id| {
            (
                id.clone(),
                serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
            )
        })
        .collect();
    Ok(serde_json::Value::Object(masked))
}

pub(crate) fn save_map(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
    mut incoming: HashMap<String, String>,
) -> Result<(), AppError> {
    if let Err(error) = validate_secret_map(&incoming, "Secret map") {
        zeroize_map(&mut incoming);
        return Err(error);
    }

    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            zeroize_map(&mut incoming);
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            zeroize_map(&mut incoming);
            return Err(error);
        }
    };
    if let Err(error) = validate_placeholders(map_for_kind(&secrets, kind), &incoming, "Secret map")
    {
        zeroize_map(&mut incoming);
        return Err(error);
    }
    replace_map(map_for_kind_mut(&mut secrets, kind), incoming);
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn get_secret(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
    id: &str,
) -> Result<Option<String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(map_for_kind(&secrets, kind).get(id).cloned())
}

pub(crate) fn load_masked_mcp_env(app: &tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    let result = secrets
        .mcp_env
        .iter()
        .map(|(server_id, env)| {
            let masked = env
                .keys()
                .map(|key| {
                    (
                        key.clone(),
                        serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
                    )
                })
                .collect();
            (server_id.clone(), serde_json::Value::Object(masked))
        })
        .collect();
    Ok(serde_json::Value::Object(result))
}

pub(crate) fn save_mcp_env(
    app: &tauri::AppHandle,
    mut incoming: HashMap<String, HashMap<String, String>>,
) -> Result<(), AppError> {
    if incoming.len() > MAX_SECRET_MAP_ENTRIES {
        zeroize_nested_map(&mut incoming);
        return Err(AppError::ParseError(
            "MCP environment contains too many servers".to_string(),
        ));
    }
    for (server_id, env) in &incoming {
        if server_id.is_empty() || server_id.len() > MAX_SECRET_ID_BYTES {
            zeroize_nested_map(&mut incoming);
            return Err(AppError::ParseError(
                "MCP environment contains an invalid server identifier".to_string(),
            ));
        }
        if let Err(error) = validate_secret_map(env, "MCP environment") {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    }

    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    };
    for (server_id, env) in &incoming {
        let existing = secrets.mcp_env.get(server_id);
        if env.iter().any(|(key, value)| {
            value == STORED_SECRET_PLACEHOLDER
                && !existing.is_some_and(|values| values.contains_key(key))
        }) {
            zeroize_nested_map(&mut incoming);
            return Err(AppError::ParseError(
                "MCP environment contains a placeholder without an existing encrypted secret"
                    .to_string(),
            ));
        }
    }

    let mut previous = std::mem::take(&mut secrets.mcp_env);
    let mut replacement = HashMap::with_capacity(incoming.len());
    for (server_id, env) in incoming {
        let mut existing = previous.remove(&server_id).unwrap_or_default();
        replace_map(&mut existing, env);
        if !existing.is_empty() {
            replacement.insert(server_id, existing);
        }
    }
    for env in previous.values_mut() {
        zeroize_map(env);
    }
    secrets.mcp_env = replacement;
    let referenced_google_grants: HashSet<String> = secrets
        .mcp_env
        .values()
        .filter_map(|env| env.get(GOOGLE_OAUTH_GRANT_ENV).cloned())
        .collect();
    secrets
        .google_oauth_grants
        .retain(|grant_id, _| referenced_google_grants.contains(grant_id));
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn mcp_env_for_server(
    app: &tauri::AppHandle,
    server_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.mcp_env.get(server_id).cloned().unwrap_or_default())
}

pub(crate) fn has_cloud_stt_api_key(app: &tauri::AppHandle) -> Result<bool, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets
        .cloud_stt_api_key
        .as_ref()
        .is_some_and(|secret| !secret.is_empty()))
}

pub(crate) fn cloud_stt_api_key(app: &tauri::AppHandle) -> Result<Option<String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.cloud_stt_api_key.clone())
}

pub(crate) fn save_cloud_stt_api_key(
    app: &tauri::AppHandle,
    mut api_key: String,
) -> Result<(), AppError> {
    if api_key.len() > MAX_SECRET_VALUE_BYTES {
        api_key.zeroize();
        return Err(AppError::ParseError(
            "Cloud speech-to-text API key exceeds the size limit".to_string(),
        ));
    }
    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            api_key.zeroize();
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            api_key.zeroize();
            return Err(error);
        }
    };
    if let Some(existing) = secrets.cloud_stt_api_key.as_mut() {
        existing.zeroize();
    }
    if api_key.trim().is_empty() {
        api_key.zeroize();
        secrets.cloud_stt_api_key = None;
    } else {
        secrets.cloud_stt_api_key = Some(api_key);
    }
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn network_policy_initialized(app: &tauri::AppHandle) -> Result<bool, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.network_policy_initialized)
}

pub(crate) fn mark_network_policy_initialized(app: &tauri::AppHandle) -> Result<(), AppError> {
    let _guard = lock_store()?;
    let mut secrets = load_locked(app)?;
    if !secrets.network_policy_initialized {
        secrets.network_policy_initialized = true;
        secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
    }
    Ok(())
}

pub(crate) fn delete_legacy_credentials(app: &tauri::AppHandle) -> Vec<String> {
    let mut credentials = HashSet::new();
    let mut failures = Vec::new();
    for (namespace, index_key) in [
        ("model", API_KEY_INDEX),
        ("search", SEARCH_API_KEY_INDEX),
        ("mcp", MCP_API_KEY_INDEX),
    ] {
        match load_legacy_index(app, index_key) {
            Ok(ids) => credentials.extend(
                ids.into_iter()
                    .map(|id| LegacyCredential::new(namespace, &id)),
            ),
            Err(error) => failures.push(error.to_string()),
        }
    }
    match load_legacy_index(app, MCP_ENV_KEY_INDEX) {
        Ok(server_ids) => {
            for server_id in server_ids {
                match load_legacy_index(app, &format!("mcp-env:{server_id}")) {
                    Ok(keys) => credentials.extend(keys.into_iter().map(|key| {
                        LegacyCredential::new("mcp-env", &format!("{server_id}:{key}"))
                    })),
                    Err(error) => failures.push(error.to_string()),
                }
            }
        }
        Err(error) => failures.push(error.to_string()),
    }
    credentials.insert(LegacyCredential::new(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID));
    credentials.insert(LegacyCredential::new(
        NETWORK_POLICY_NAMESPACE,
        NETWORK_POLICY_KEY_ID,
    ));
    match secure_storage::load_json::<NativeSecrets>(app, StorageDomain::Secrets) {
        Ok(Some(secrets)) => credentials.extend(secrets.legacy_cleanup_pending.iter().cloned()),
        Ok(None) => {}
        Err(error) => failures.push(error.to_string()),
    }

    failures.extend(credentials.into_iter().filter_map(|credential| {
        keyring::delete_secret(&credential.namespace, &credential.id)
            .err()
            .map(|error| error.to_string())
    }));
    failures
}

#[cfg(test)]
mod tests {
    use super::{replace_map, validate_placeholders, STORED_SECRET_PLACEHOLDER};
    use std::collections::HashMap;

    #[test]
    fn placeholder_preserves_existing_secret_without_storing_mask() {
        let mut existing = HashMap::from([("provider".to_string(), "real-secret".to_string())]);
        let incoming = HashMap::from([(
            "provider".to_string(),
            STORED_SECRET_PLACEHOLDER.to_string(),
        )]);

        validate_placeholders(&existing, &incoming, "test").expect("valid placeholder");
        replace_map(&mut existing, incoming);

        assert_eq!(
            existing.get("provider").map(String::as_str),
            Some("real-secret")
        );
    }

    #[test]
    fn placeholder_without_existing_secret_is_rejected() {
        let existing = HashMap::new();
        let incoming = HashMap::from([(
            "provider".to_string(),
            STORED_SECRET_PLACEHOLDER.to_string(),
        )]);

        assert!(validate_placeholders(&existing, &incoming, "test").is_err());
    }
}
