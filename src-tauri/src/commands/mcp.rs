use crate::commands::config::{get_mcp_api_key, load_mcp_env_secrets_for_server};
use crate::mcp;
use crate::AppError;
use ring::digest::{digest, SHA256};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroize;

#[derive(Default)]
struct ToolCallRegistry {
    active: HashMap<String, CancellationToken>,
    cancelled_before_registration: HashMap<String, Instant>,
}

static TOOL_CALLS: LazyLock<Mutex<ToolCallRegistry>> =
    LazyLock::new(|| Mutex::new(ToolCallRegistry::default()));

const MCP_APPROVAL_TTL: Duration = Duration::from_secs(60);
const PENDING_CANCELLATION_TTL: Duration = Duration::from_secs(5 * 60);

struct McpToolApproval {
    server_id: String,
    tool_name: String,
    argument_hash: [u8; 32],
    conversation_id: String,
    connection_generation: u64,
    expires_at: Instant,
}

static MCP_TOOL_APPROVALS: LazyLock<Mutex<HashMap<String, McpToolApproval>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn hash_tool_arguments(arguments: &serde_json::Value) -> Result<[u8; 32], AppError> {
    let canonical = serde_json::to_vec(arguments)
        .map_err(|e| AppError::ParseError(format!("Failed to canonicalize tool arguments: {e}")))?;
    let hash = digest(&SHA256, &canonical);
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(hash.as_ref());
    Ok(bytes)
}

fn issue_tool_approval(
    server_id: &str,
    tool_name: &str,
    argument_hash: [u8; 32],
    conversation_id: &str,
    connection_generation: u64,
    ttl: Duration,
) -> Result<String, AppError> {
    let capability = uuid::Uuid::new_v4().to_string();
    let now = Instant::now();
    let mut approvals = MCP_TOOL_APPROVALS
        .lock()
        .map_err(|_| AppError::McpError("MCP approval store is unavailable".to_string()))?;
    approvals.retain(|_, approval| approval.expires_at > now);
    approvals.insert(
        capability.clone(),
        McpToolApproval {
            server_id: server_id.to_string(),
            tool_name: tool_name.to_string(),
            argument_hash,
            conversation_id: conversation_id.to_string(),
            connection_generation,
            expires_at: now + ttl,
        },
    );
    Ok(capability)
}

fn consume_tool_approval(
    capability: &str,
    server_id: &str,
    tool_name: &str,
    argument_hash: [u8; 32],
    conversation_id: &str,
    connection_generation: u64,
) -> Result<(), AppError> {
    let approval = MCP_TOOL_APPROVALS
        .lock()
        .map_err(|_| AppError::McpError("MCP approval store is unavailable".to_string()))?
        .remove(capability);

    let matches = approval.is_some_and(|approval| {
        approval.expires_at > Instant::now()
            && approval.server_id == server_id
            && approval.tool_name == tool_name
            && approval.argument_hash == argument_hash
            && approval.conversation_id == conversation_id
            && approval.connection_generation == connection_generation
    });

    if !matches {
        return Err(AppError::McpError(
            "MCP tool approval is missing, expired, already used, or does not match this call"
                .to_string(),
        ));
    }

    Ok(())
}

fn clear_server_tool_approvals(server_id: &str) {
    if let Ok(mut approvals) = MCP_TOOL_APPROVALS.lock() {
        approvals.retain(|_, approval| approval.server_id != server_id);
    }
}

fn register_tool_call(request_id: &str) -> Result<CancellationToken, AppError> {
    let mut registry = TOOL_CALLS.lock().unwrap_or_else(|error| error.into_inner());
    let now = Instant::now();
    registry
        .cancelled_before_registration
        .retain(|_, expires_at| *expires_at > now);
    if registry.active.contains_key(request_id) {
        return Err(AppError::McpError(format!(
            "MCP request ID is already active: {request_id}"
        )));
    }
    let token = CancellationToken::new();
    if registry
        .cancelled_before_registration
        .remove(request_id)
        .is_some()
    {
        token.cancel();
    }
    registry
        .active
        .insert(request_id.to_string(), token.clone());
    Ok(token)
}

fn cancel_registered_tool_call(request_id: &str) -> bool {
    let mut registry = TOOL_CALLS.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(token) = registry.active.get(request_id) {
        token.cancel();
        return true;
    }

    let now = Instant::now();
    registry
        .cancelled_before_registration
        .retain(|_, expires_at| *expires_at > now);
    registry
        .cancelled_before_registration
        .insert(request_id.to_string(), now + PENDING_CANCELLATION_TTL);
    true
}

fn finish_tool_call(request_id: &str) {
    let mut registry = TOOL_CALLS.lock().unwrap_or_else(|error| error.into_inner());
    registry.active.remove(request_id);
    registry.cancelled_before_registration.remove(request_id);
}

struct ToolCallRegistration(String);

impl Drop for ToolCallRegistration {
    fn drop(&mut self) {
        finish_tool_call(&self.0);
    }
}

#[tauri::command]
pub async fn mcp_start_server(
    config: String,
    explicitly_enabled: bool,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    crate::ensure_online()?;
    let mut server_config: mcp::McpServerConfig = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP config JSON: {}", e)))?;
    clear_server_tool_approvals(&server_config.id);

    {
        let mut manager = mcp::MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.set_explicitly_enabled(&server_config.id, explicitly_enabled);
    }

    server_config.apiKey = None;
    if let Some(key) = get_mcp_api_key(&app, &server_config.id)? {
        if !key.is_empty() {
            server_config.apiKey = Some(key);
        }
    }
    let mut env_map = load_mcp_env_secrets_for_server(&app, &server_config.id)?;
    crate::commands::oauth::prepare_google_mcp_environment(&app, &mut env_map)?;

    let tools = mcp::client::connect_server(&server_config, env_map).await;
    if let Some(api_key) = server_config.apiKey.as_mut() {
        api_key.zeroize();
    }
    let tools = tools.map_err(|e| {
        log::error!("MCP server start failed: {}", e);
        AppError::McpError(e)
    })?;

    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_set_server_enabled(server_id: String, enabled: bool) -> Result<(), AppError> {
    if !enabled {
        clear_server_tool_approvals(&server_id);
    }
    let mut manager = mcp::MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    manager.set_explicitly_enabled(&server_id, enabled);
    Ok(())
}

#[tauri::command]
pub async fn mcp_check_command(command: String) -> Result<String, AppError> {
    let info = mcp::client::check_executable(&command).await;
    Ok(serde_json::to_string(&info).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_stop_server(server_id: String) -> Result<(), AppError> {
    clear_server_tool_approvals(&server_id);
    mcp::client::disconnect_server(&server_id).map_err(|e| {
        log::error!("MCP server stop failed: {}", e);
        AppError::McpError(e)
    })
}

#[tauri::command]
pub async fn mcp_list_tools(server_id: String) -> Result<String, AppError> {
    let manager = crate::mcp::MCP_SERVERS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tools = manager.get_tools(&server_id);
    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_list_resources(server_id: String) -> Result<String, AppError> {
    crate::ensure_online()?;
    let result = mcp::client::list_resources_on_server(&server_id)
        .await
        .map_err(AppError::McpError)?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_list_prompts(server_id: String) -> Result<String, AppError> {
    crate::ensure_online()?;
    let result = mcp::client::list_prompts_on_server(&server_id)
        .await
        .map_err(AppError::McpError)?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

fn get_tool_authorization(
    server_id: &str,
    tool_name: &str,
) -> Result<mcp::McpToolAuthorization, AppError> {
    mcp::MCP_SERVERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .tool_authorization(server_id, tool_name)
        .map_err(AppError::McpError)
}

#[tauri::command]
pub async fn mcp_request_tool_approval(
    app: tauri::AppHandle,
    server_id: String,
    tool_name: String,
    arguments: String,
    conversation_id: Option<String>,
) -> Result<Option<String>, AppError> {
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::ParseError(format!("Invalid tool arguments JSON: {e}")))?;
    let authorization = get_tool_authorization(&server_id, &tool_name)?;
    if !authorization.requires_approval {
        return Ok(None);
    }

    let conversation_id = conversation_id.filter(|id| !id.is_empty()).ok_or_else(|| {
        AppError::McpError("Untrusted MCP tool calls require a conversation scope".to_string())
    })?;
    let argument_hash = hash_tool_arguments(&args)?;
    let pretty_arguments = serde_json::to_string_pretty(&args).unwrap_or(arguments);
    let argument_preview: String = pretty_arguments.chars().take(4_000).collect();
    let truncated = pretty_arguments.chars().count() > argument_preview.chars().count();
    let server_label = serde_json::to_string(&authorization.server_name)
        .unwrap_or_else(|_| "\"unknown server\"".to_string());
    let transport_label = serde_json::to_string(&authorization.transport)
        .unwrap_or_else(|_| "\"unknown transport\"".to_string());
    let tool_label =
        serde_json::to_string(&tool_name).unwrap_or_else(|_| "\"unknown tool\"".to_string());
    let message = format!(
        "Allow the untrusted MCP server {} ({}) to run tool {}?\n\nArguments:\n{}{}\n\nThis approval expires in 60 seconds and can be used once.",
        server_label,
        transport_label,
        tool_label,
        argument_preview,
        if truncated { "\n…" } else { "" }
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title("Untrusted MCP Tool Confirmation")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });

    if !rx.await.unwrap_or(false) {
        return Err(AppError::McpError(
            "MCP tool execution rejected by the user".to_string(),
        ));
    }

    // Revalidate after the user responds so a reconnect or trust/config change
    // cannot receive an approval for stale server state.
    let current_authorization = get_tool_authorization(&server_id, &tool_name)?;
    if !current_authorization.requires_approval {
        return Ok(None);
    }
    if current_authorization.connection_generation != authorization.connection_generation {
        return Err(AppError::McpError(
            "MCP server reconnected while approval was pending; confirm the tool again".to_string(),
        ));
    }

    issue_tool_approval(
        &server_id,
        &tool_name,
        argument_hash,
        &conversation_id,
        authorization.connection_generation,
        MCP_APPROVAL_TTL,
    )
    .map(Some)
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: String,
    request_id: Option<String>,
    conversation_id: Option<String>,
    approval_capability: Option<String>,
) -> Result<String, AppError> {
    crate::ensure_online()?;
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::ParseError(format!("Invalid tool arguments JSON: {}", e)))?;

    let authorization = get_tool_authorization(&server_id, &tool_name)?;
    if authorization.requires_approval {
        let conversation_id = conversation_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                AppError::McpError(
                    "Untrusted MCP tool calls require a conversation scope and native approval"
                        .to_string(),
                )
            })?;
        let approval_capability = approval_capability.as_deref().ok_or_else(|| {
            AppError::McpError("Untrusted MCP tool call is missing native approval".to_string())
        })?;
        consume_tool_approval(
            approval_capability,
            &server_id,
            &tool_name,
            hash_tool_arguments(&args)?,
            conversation_id,
            authorization.connection_generation,
        )?;
    }

    let registration = match request_id.as_deref() {
        Some(request_id) => Some((
            register_tool_call(request_id)?,
            ToolCallRegistration(request_id.to_string()),
        )),
        None => None,
    };
    let cancel_token = registration.as_ref().map(|(token, _guard)| token.clone());

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        mcp::client::call_tool_on_server(&server_id, &tool_name, &args, cancel_token),
    )
    .await
    .map_err(|_| AppError::McpError("MCP tool call timed out after 120 seconds".to_string()))?
    .map_err(|e| {
        log::error!("MCP tool call failed: {}", e);
        AppError::McpError(e)
    })?;

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub fn mcp_cancel_tool_call(request_id: String) -> Result<bool, AppError> {
    Ok(cancel_registered_tool_call(&request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_call_registry_cancels_only_the_requested_call() {
        let first = register_tool_call("request-first").expect("register first request");
        let second = register_tool_call("request-second").expect("register second request");

        assert!(cancel_registered_tool_call("request-first"));
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        finish_tool_call("request-first");
        finish_tool_call("request-second");
        let registry = TOOL_CALLS.lock().expect("lock tool-call registry");
        assert!(!registry.active.contains_key("request-first"));
        assert!(!registry.active.contains_key("request-second"));
    }

    #[test]
    fn tool_call_registry_rejects_duplicate_request_ids() {
        let _token = register_tool_call("request-duplicate").expect("register request");
        let duplicate = register_tool_call("request-duplicate");

        assert!(duplicate.is_err());
        finish_tool_call("request-duplicate");
    }

    #[test]
    fn tool_call_registry_applies_cancellation_requested_before_registration() {
        assert!(cancel_registered_tool_call("request-pending"));

        let token = register_tool_call("request-pending").expect("register pending request");

        assert!(token.is_cancelled());
        finish_tool_call("request-pending");
    }

    #[test]
    fn tool_approval_is_single_use_and_bound_to_call_context() {
        let arguments = serde_json::json!({ "path": "notes.txt", "content": "hello" });
        let argument_hash = hash_tool_arguments(&arguments).expect("hash arguments");
        let capability = issue_tool_approval(
            "server-a",
            "write_file",
            argument_hash,
            "conversation-a",
            7,
            Duration::from_secs(60),
        )
        .expect("issue approval");

        consume_tool_approval(
            &capability,
            "server-a",
            "write_file",
            argument_hash,
            "conversation-a",
            7,
        )
        .expect("consume matching approval");
        assert!(consume_tool_approval(
            &capability,
            "server-a",
            "write_file",
            argument_hash,
            "conversation-a",
            7,
        )
        .is_err());

        for (server_id, tool_name, args, conversation_id, generation) in [
            (
                "server-b",
                "write_file",
                arguments.clone(),
                "conversation-a",
                7,
            ),
            (
                "server-a",
                "delete_file",
                arguments.clone(),
                "conversation-a",
                7,
            ),
            (
                "server-a",
                "write_file",
                serde_json::json!({ "path": "other.txt" }),
                "conversation-a",
                7,
            ),
            (
                "server-a",
                "write_file",
                arguments.clone(),
                "conversation-b",
                7,
            ),
            (
                "server-a",
                "write_file",
                arguments.clone(),
                "conversation-a",
                8,
            ),
        ] {
            let capability = issue_tool_approval(
                "server-a",
                "write_file",
                argument_hash,
                "conversation-a",
                7,
                Duration::from_secs(60),
            )
            .expect("issue bound approval");
            assert!(consume_tool_approval(
                &capability,
                server_id,
                tool_name,
                hash_tool_arguments(&args).expect("hash comparison arguments"),
                conversation_id,
                generation,
            )
            .is_err());
        }
    }

    #[test]
    fn expired_tool_approval_is_rejected() {
        let argument_hash = hash_tool_arguments(&serde_json::json!({})).expect("hash arguments");
        let capability = issue_tool_approval(
            "server",
            "tool",
            argument_hash,
            "conversation",
            1,
            Duration::ZERO,
        )
        .expect("issue expired approval");

        assert!(consume_tool_approval(
            &capability,
            "server",
            "tool",
            argument_hash,
            "conversation",
            1,
        )
        .is_err());
    }
}
