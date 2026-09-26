use crate::secret_storage::{self, SecretMapKind};
use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use crate::NetworkConfig;
use crate::NETWORK_CONFIG;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn validate_network_config(config: &NetworkConfig) -> Result<(), AppError> {
    if config.blocked_hosts.len() > 2048 {
        return Err(AppError::ParseError(
            "Network policy contains too many blocked-host entries".to_string(),
        ));
    }
    if config.blocked_hosts.iter().any(|host| {
        host.is_empty()
            || host.len() > 512
            || host
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
    }) {
        return Err(AppError::ParseError(
            "Network policy contains an invalid blocked-host entry".to_string(),
        ));
    }
    if config.allowed_local_endpoints.len() > 128 {
        return Err(AppError::ParseError(
            "Network policy contains too many local endpoint grants".to_string(),
        ));
    }
    for endpoint in &config.allowed_local_endpoints {
        crate::endpoint_security::validate_local_grant(endpoint).map_err(AppError::ParseError)?;
    }
    Ok(())
}

// --- Commands ---

#[tauri::command(async)]
pub fn load_encrypted_preferences(
    app: tauri::AppHandle,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    secure_storage::load_preferences(&app)
}

#[tauri::command(async)]
pub fn mutate_encrypted_preferences(
    app: tauri::AppHandle,
    sets: serde_json::Map<String, serde_json::Value>,
    deletes: Vec<String>,
    clear: bool,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    secure_storage::mutate_preferences(&app, sets, &deletes, clear)
}

#[tauri::command]
pub async fn load_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config: Option<serde_json::Value> = secure_storage::load_json(&app, StorageDomain::Models)?;
    config
        .map(|value| serde_json::to_string(&value).map_err(|e| AppError::ParseError(e.to_string())))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| AppError::ParseError(e.to_string()))?;
    if !parsed.is_array() {
        return Err(AppError::ParseError(
            "Model configuration must be an array".to_string(),
        ));
    }
    secure_storage::save_json(&app, StorageDomain::Models, &parsed)
}

pub fn load_network_config_internal(app: &tauri::AppHandle) -> Result<NetworkConfig, AppError> {
    match secure_storage::load_json(app, StorageDomain::Network)? {
        Some(config) => {
            validate_network_config(&config)?;
            secret_storage::mark_network_policy_initialized(app)?;
            Ok(config)
        }
        None if secret_storage::network_policy_initialized(app)? => Err(AppError::ConfigIo(
            "The authenticated network policy is missing".to_string(),
        )),
        None => Ok(NetworkConfig::default()),
    }
}

#[tauri::command]
pub async fn load_network_config(app: tauri::AppHandle) -> Result<String, AppError> {
    if !secure_storage::domain_file_exists(&app, StorageDomain::Network)?
        && !secret_storage::network_policy_initialized(&app)?
    {
        return Ok(String::new());
    }
    let config = load_network_config_internal(&app)?;
    serde_json::to_string(&config).map_err(|e| AppError::ParseError(e.to_string()))
}

#[tauri::command]
pub async fn save_network_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let config_struct: NetworkConfig =
        serde_json::from_str(&config).map_err(|e| AppError::ParseError(e.to_string()))?;
    validate_network_config(&config_struct)?;
    secure_storage::save_json(&app, StorageDomain::Network, &config_struct)?;
    secret_storage::mark_network_policy_initialized(&app)?;

    if let Ok(mut lock) = NETWORK_CONFIG.write() {
        *lock = config_struct;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_search_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config: Option<serde_json::Value> = secure_storage::load_json(&app, StorageDomain::Search)?;
    config
        .map(|value| serde_json::to_string(&value).map_err(|e| AppError::ParseError(e.to_string())))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub async fn save_search_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let parsed = serde_json::from_str::<serde_json::Value>(&config)
        .map_err(|e| AppError::ParseError(e.to_string()))?;
    secure_storage::save_json(&app, StorageDomain::Search, &parsed)
}

#[tauri::command]
pub async fn load_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    secret_storage::load_masked_map(&app, SecretMapKind::Model)
}

#[tauri::command]
pub async fn save_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    let keys = serde_json::from_value::<HashMap<String, String>>(keys)
        .map_err(|error| AppError::ParseError(format!("Invalid API keys payload: {error}")))?;
    secret_storage::save_map(&app, SecretMapKind::Model, keys)
}

#[tauri::command]
pub async fn load_search_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    secret_storage::load_masked_map(&app, SecretMapKind::Search)
}

#[tauri::command]
pub async fn save_search_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    let keys = serde_json::from_value::<HashMap<String, String>>(keys).map_err(|error| {
        AppError::ParseError(format!("Invalid search API keys payload: {error}"))
    })?;
    secret_storage::save_map(&app, SecretMapKind::Search, keys)
}

#[tauri::command]
pub async fn load_mcp_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    secret_storage::load_masked_map(&app, SecretMapKind::Mcp)
}

#[tauri::command]
pub async fn save_mcp_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    let keys = serde_json::from_value::<HashMap<String, String>>(keys)
        .map_err(|error| AppError::ParseError(format!("Invalid MCP API keys payload: {error}")))?;
    secret_storage::save_map(&app, SecretMapKind::Mcp, keys)
}

pub fn get_cloud_stt_api_key(app: &tauri::AppHandle) -> Result<String, AppError> {
    secret_storage::cloud_stt_api_key(app)?.ok_or_else(|| {
        AppError::KeyNotFound("Cloud speech-to-text API key is not configured".to_string())
    })
}

pub fn get_search_api_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<Option<String>, AppError> {
    secret_storage::get_secret(app, SecretMapKind::Search, config_id)
}

pub fn get_mcp_api_key(
    app: &tauri::AppHandle,
    server_id: &str,
) -> Result<Option<String>, AppError> {
    secret_storage::get_secret(app, SecretMapKind::Mcp, server_id)
}

#[tauri::command]
pub fn has_cloud_stt_api_key(app: tauri::AppHandle) -> Result<bool, AppError> {
    secret_storage::has_cloud_stt_api_key(&app)
}

#[tauri::command]
pub fn save_cloud_stt_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), AppError> {
    secret_storage::save_cloud_stt_api_key(&app, api_key)
}

#[tauri::command]
pub async fn load_mcp_env_secrets(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    secret_storage::load_masked_mcp_env(&app)
}

#[tauri::command]
pub async fn save_mcp_env_secrets_cmd(
    app: tauri::AppHandle,
    secrets: serde_json::Value,
) -> Result<(), AppError> {
    let secrets = serde_json::from_value::<HashMap<String, HashMap<String, String>>>(secrets)
        .map_err(|error| {
            AppError::ParseError(format!("Invalid MCP environment secrets payload: {error}"))
        })?;
    secret_storage::save_mcp_env(&app, secrets)
}

pub fn load_mcp_env_secrets_for_server(
    app: &tauri::AppHandle,
    server_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    secret_storage::mcp_env_for_server(app, server_id)
}

#[tauri::command]
pub async fn wipe_config_files(app: tauri::AppHandle) -> Result<(), AppError> {
    let _secret_guard = secret_storage::lock_for_wipe()?;
    let mut failures = secret_storage::delete_legacy_credentials(&app);
    if let Err(error) = crate::commands::conversations::wipe_encrypted_conversations(&app) {
        failures.push(error.to_string());
    }

    if !failures.is_empty() {
        return Err(AppError::ConfigIo(format!(
            "Credential wipe was incomplete; secret indices were preserved for retry: {}",
            failures.join("; ")
        )));
    }

    if let Err(error) = secure_storage::remove_all_settings_files(&app) {
        failures.push(error.to_string());
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::ConfigIo(format!(
            "Data wipe was incomplete: {}",
            failures.join("; ")
        )))
    }
}

#[derive(Deserialize, Serialize)]
pub struct ModelConfig {
    pub id: String,
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub provider: Option<String>,
}

pub async fn get_model_config_and_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<(String, String, String, Option<String>), AppError> {
    let configs: Vec<ModelConfig> = secure_storage::load_json(app, StorageDomain::Models)?
        .ok_or_else(|| AppError::ConfigIo("Model configuration not found".to_string()))?;

    let config = configs
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| {
            AppError::ConfigIo(format!("Model config not found for ID: {}", config_id))
        })?;

    let api_key =
        secret_storage::get_secret(app, SecretMapKind::Model, config_id)?.unwrap_or_default();

    Ok((config.api_base, api_key, config.model_id, config.provider))
}
