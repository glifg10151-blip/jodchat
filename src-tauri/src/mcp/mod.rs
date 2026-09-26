pub mod client;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use zeroize::Zeroize;

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub baseUrl: Option<String>,
    pub apiKey: Option<String>,
    pub enabled: bool,
    pub trustLevel: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub inputSchema: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readOnlyHint: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpImageContent {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: String,
    #[serde(rename = "isError")]
    pub is_error: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<McpImageContent>,
}

pub enum McpServerRequest {
    CallTool {
        tool_name: String,
        arguments: serde_json::Value,
        cancel_token: Option<tokio_util::sync::CancellationToken>,
        reply_tx: tokio::sync::oneshot::Sender<Result<McpToolResult, String>>,
    },
    ListResources {
        reply_tx: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
    },
    ListPrompts {
        reply_tx: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
    },
}

#[derive(Debug, Clone)]
pub struct McpServerHandle {
    pub tools: Vec<McpToolInfo>,
    pub cancel_token: tokio_util::sync::CancellationToken,
    pub request_tx: Option<tokio::sync::mpsc::Sender<McpServerRequest>>,
    pub config: McpServerConfig,
    pub env_secrets: HashMap<String, String>,
    pub connection_generation: u64,
}

impl Drop for McpServerHandle {
    fn drop(&mut self) {
        if let Some(api_key) = self.config.apiKey.as_mut() {
            api_key.zeroize();
        }
        for secret in self.env_secrets.values_mut() {
            secret.zeroize();
        }
        self.env_secrets.clear();
    }
}

pub struct McpServerManager {
    pub servers: HashMap<String, McpServerHandle>,
    connection_generations: HashMap<String, u64>,
    explicitly_enabled: HashSet<String>,
}

pub struct McpToolAuthorization {
    pub requires_approval: bool,
    pub server_name: String,
    pub transport: String,
    pub connection_generation: u64,
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            servers: HashMap::new(),
            connection_generations: HashMap::new(),
            explicitly_enabled: HashSet::new(),
        }
    }

    pub fn begin_connection(&mut self, server_id: &str) -> u64 {
        let generation = self
            .connection_generations
            .get(server_id)
            .copied()
            .unwrap_or(0)
            .saturating_add(1);
        self.connection_generations
            .insert(server_id.to_string(), generation);
        if let Some(handle) = self.servers.remove(server_id) {
            handle.cancel_token.cancel();
        }
        generation
    }

    pub fn complete_connection(
        &mut self,
        server_id: String,
        generation: u64,
        handle: McpServerHandle,
    ) -> bool {
        if self.connection_generations.get(&server_id).copied() != Some(generation) {
            handle.cancel_token.cancel();
            return false;
        }
        self.servers.insert(server_id, handle);
        true
    }

    pub fn disconnect_server(&mut self, server_id: &str) {
        let _ = self.begin_connection(server_id);
    }

    pub fn set_explicitly_enabled(&mut self, server_id: &str, enabled: bool) {
        if enabled {
            self.explicitly_enabled.insert(server_id.to_string());
        } else {
            self.explicitly_enabled.remove(server_id);
            self.disconnect_server(server_id);
        }
    }

    pub fn mark_idle(&mut self, server_id: &str, generation: u64) {
        if let Some(handle) = self.servers.get_mut(server_id) {
            if handle.connection_generation == generation {
                handle.request_tx = None;
            }
        }
    }

    pub fn respawn_config(
        &self,
        server_id: &str,
    ) -> Result<Option<(McpServerConfig, HashMap<String, String>)>, String> {
        if !self.explicitly_enabled.contains(server_id) {
            return Err(format!(
                "MCP server '{}' is not explicitly enabled",
                server_id
            ));
        }
        let handle = self
            .servers
            .get(server_id)
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?;
        if !handle.config.enabled {
            return Err(format!("MCP server '{}' is disabled", server_id));
        }
        if self.connection_generations.get(server_id).copied() != Some(handle.connection_generation)
        {
            return Err(format!("MCP server '{}' connection is stale", server_id));
        }
        Ok(handle
            .request_tx
            .is_none()
            .then(|| (handle.config.clone(), handle.env_secrets.clone())))
    }

    pub fn executable_request_tx(
        &self,
        server_id: &str,
    ) -> Result<tokio::sync::mpsc::Sender<McpServerRequest>, String> {
        if !self.explicitly_enabled.contains(server_id) {
            return Err(format!(
                "MCP server '{}' is not explicitly enabled",
                server_id
            ));
        }
        let handle = self
            .servers
            .get(server_id)
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?;
        if !handle.config.enabled {
            return Err(format!("MCP server '{}' is disabled", server_id));
        }
        if self.connection_generations.get(server_id).copied() != Some(handle.connection_generation)
        {
            return Err(format!("MCP server '{}' connection is stale", server_id));
        }
        handle
            .request_tx
            .clone()
            .ok_or_else(|| format!("MCP server '{}' is not connected", server_id))
    }

    pub fn get_tools(&self, server_id: &str) -> Vec<McpToolInfo> {
        self.servers
            .get(server_id)
            .filter(|handle| {
                handle.config.enabled
                    && self.explicitly_enabled.contains(server_id)
                    && self.connection_generations.get(server_id).copied()
                        == Some(handle.connection_generation)
            })
            .map(|h| h.tools.clone())
            .unwrap_or_default()
    }

    pub fn tool_authorization(
        &self,
        server_id: &str,
        tool_name: &str,
    ) -> Result<McpToolAuthorization, String> {
        let _request_tx = self.executable_request_tx(server_id)?;
        let handle = self
            .servers
            .get(server_id)
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?;
        if !handle.tools.iter().any(|tool| tool.name == tool_name) {
            return Err(format!(
                "MCP tool '{}' is not advertised by server '{}'",
                tool_name, server_id
            ));
        }

        Ok(McpToolAuthorization {
            requires_approval: handle.config.trustLevel.as_deref() != Some("trusted"),
            server_name: handle.config.name.clone(),
            transport: handle.config.transport.clone(),
            connection_generation: handle.connection_generation,
        })
    }
}

pub static MCP_SERVERS: LazyLock<Mutex<McpServerManager>> =
    LazyLock::new(|| Mutex::new(McpServerManager::new()));

#[cfg(test)]
mod tests {
    use super::*;

    fn config(id: &str, enabled: bool) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            transport: "stdio".to_string(),
            command: Some("test".to_string()),
            args: Some(Vec::new()),
            baseUrl: None,
            apiKey: None,
            enabled,
            trustLevel: Some("untrusted".to_string()),
        }
    }

    fn handle(id: &str, enabled: bool, generation: u64) -> McpServerHandle {
        let (request_tx, _request_rx) = tokio::sync::mpsc::channel(1);
        McpServerHandle {
            tools: vec![McpToolInfo {
                name: "test_tool".to_string(),
                description: "Test tool".to_string(),
                inputSchema: serde_json::json!({ "type": "object" }),
                readOnlyHint: None,
            }],
            cancel_token: tokio_util::sync::CancellationToken::new(),
            request_tx: Some(request_tx),
            config: config(id, enabled),
            env_secrets: HashMap::new(),
            connection_generation: generation,
        }
    }

    #[test]
    fn revoked_generation_cannot_restore_a_server() {
        let mut manager = McpServerManager::new();
        manager.set_explicitly_enabled("server", true);
        let stale_generation = manager.begin_connection("server");

        manager.set_explicitly_enabled("server", false);

        assert!(!manager.complete_connection(
            "server".to_string(),
            stale_generation,
            handle("server", true, stale_generation),
        ));
        assert!(manager.executable_request_tx("server").is_err());
        assert!(!manager.servers.contains_key("server"));
    }

    #[test]
    fn execution_requires_config_and_explicit_enablement() {
        let mut manager = McpServerManager::new();
        manager.set_explicitly_enabled("server", true);
        let generation = manager.begin_connection("server");
        assert!(manager.complete_connection(
            "server".to_string(),
            generation,
            handle("server", false, generation),
        ));
        assert!(manager.executable_request_tx("server").is_err());

        manager.set_explicitly_enabled("server", false);
        assert!(manager.executable_request_tx("server").is_err());
    }

    #[test]
    fn tool_authorization_defaults_to_untrusted_and_validates_tool() {
        let mut manager = McpServerManager::new();
        manager.set_explicitly_enabled("server", true);
        let generation = manager.begin_connection("server");
        assert!(manager.complete_connection(
            "server".to_string(),
            generation,
            handle("server", true, generation),
        ));

        let authorization = manager
            .tool_authorization("server", "test_tool")
            .expect("authorize advertised tool");
        assert!(authorization.requires_approval);
        assert_eq!(authorization.connection_generation, generation);
        assert!(manager
            .tool_authorization("server", "missing_tool")
            .is_err());

        manager
            .servers
            .get_mut("server")
            .expect("connected server")
            .config
            .trustLevel = Some("trusted".to_string());
        assert!(
            !manager
                .tool_authorization("server", "test_tool")
                .expect("authorize trusted tool")
                .requires_approval
        );
    }
}
