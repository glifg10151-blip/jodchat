use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatWsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct TypingEvent {
    pub user_id: String,
    pub is_typing: bool,
    pub chat_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct WsEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[allow(dead_code)]
impl WsEvent {
    pub fn message(msg: ChatWsMessage) -> Self {
        WsEvent {
            event_type: "message".to_string(),
            payload: serde_json::to_value(&msg).unwrap_or_default(),
            timestamp: msg.timestamp.clone(),
        }
    }

    pub fn typing(typing: TypingEvent) -> Self {
        WsEvent {
            event_type: "typing".to_string(),
            payload: serde_json::to_value(&typing).unwrap_or_default(),
            timestamp: typing.timestamp.clone(),
        }
    }

    pub fn connection_status(status: &str) -> Self {
        WsEvent {
            event_type: "connection".to_string(),
            payload: serde_json::json!({ "status": status }),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn error(message: String) -> Self {
        WsEvent {
            event_type: "error".to_string(),
            payload: serde_json::json!({ "message": message }),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConfig {
    pub url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub reconnect: bool,
    pub max_reconnect_attempts: u32,
}

impl Default for WsConfig {
    fn default() -> Self {
        WsConfig {
            url: String::new(),
            api_key: None,
            model: "gpt-4o".to_string(),
            reconnect: true,
            max_reconnect_attempts: 5,
        }
    }
}

#[derive(Debug, Serialize)]
struct AuthFrame {
    #[serde(rename = "type")]
    frame_type: String,
    key: String,
}

#[derive(Debug, Serialize)]
struct ConfigFrame {
    #[serde(rename = "type")]
    frame_type: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct TypingFrame {
    #[serde(rename = "type")]
    frame_type: String,
    is_typing: bool,
    chat_id: Option<String>,
}

#[allow(dead_code)]
pub struct WebSocketConnection {
    config: WsConfig,
    reconnect_count: u32,
}

#[allow(dead_code)]
impl WebSocketConnection {
    pub fn new(config: WsConfig) -> Self {
        WebSocketConnection {
            config,
            reconnect_count: 0,
        }
    }

    fn calculate_backoff(&self) -> Duration {
        let base_delay = Duration::from_secs(1);
        let max_delay = Duration::from_secs(30);

        let delay = base_delay * (2u32.pow(self.reconnect_count.min(5)));
        delay.min(max_delay)
    }

    fn should_reconnect(&self) -> bool {
        self.config.reconnect && self.reconnect_count < self.config.max_reconnect_attempts
    }
}

#[allow(dead_code)]
pub async fn ws_chat_stream(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    crate::ensure_online().map_err(|error| error.to_string())?;
    use tauri::Emitter;

    let mut connection = WebSocketConnection::new(ws_config.clone());

    loop {
        match run_ws_connection(&ws_config, &app_handle).await {
            Ok(content) => return Ok(content),
            Err(e) => {
                if !connection.should_reconnect() {
                    let err_msg = format!("WebSocket connection failed after retries: {}", e);
                    let _ = app_handle.emit("ws-error", &err_msg);
                    return Err(err_msg);
                }

                connection.reconnect_count += 1;
                let backoff = connection.calculate_backoff();

                let _ = app_handle.emit(
                    "ws-reconnecting",
                    &serde_json::json!({
                        "attempt": connection.reconnect_count,
                        "max_attempts": connection.config.max_reconnect_attempts,
                        "delay_ms": backoff.as_millis()
                    }),
                );

                sleep(backoff).await;
            }
        }
    }
}

#[allow(dead_code)]
async fn run_ws_connection(
    ws_config: &WsConfig,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;

    let (ws_stream, _) = connect_validated(ws_config).await?;

    let (mut write, mut read) = ws_stream.split();

    if let Some(ref key) = ws_config.api_key {
        let auth_frame = AuthFrame {
            frame_type: "auth".to_string(),
            key: key.clone(),
        };
        let auth_json =
            serde_json::to_string(&auth_frame).map_err(|e| format!("Serialize error: {}", e))?;
        write
            .send(Message::Text(auth_json.into()))
            .await
            .map_err(|e| format!("Send auth failed: {}", e))?;
    }

    let config_frame = ConfigFrame {
        frame_type: "config".to_string(),
        model: ws_config.model.clone(),
    };
    let config_json =
        serde_json::to_string(&config_frame).map_err(|e| format!("Serialize error: {}", e))?;
    write
        .send(Message::Text(config_json.into()))
        .await
        .map_err(|e| format!("Send config failed: {}", e))?;

    let _ = app_handle.emit(
        "ws-connected",
        &serde_json::json!({
            "model": ws_config.model,
            "url": ws_config.url
        }),
    );

    let mut full_content = String::new();

    loop {
        let timeout_future = sleep(Duration::from_secs(30));
        let msg_option = tokio::select! {
            msg = read.next() => msg,
            _ = timeout_future => {
                let err_msg = "WebSocket connection timed out".to_string();
                let _ = app_handle.emit("ws-error", &err_msg);
                return Err(err_msg);
            }
        };

        match msg_option {
            Some(Ok(Message::Text(text))) => {
                let text_str = text.to_string();
                if text_str.trim() == "[DONE]" {
                    let _ = app_handle.emit("ws-closed", ());
                    break;
                }
                match serde_json::from_str::<ChatWsMessage>(&text_str) {
                    Ok(parsed) => {
                        if parsed.msg_type == "error" {
                            let _ = app_handle.emit("ws-error", &parsed.content);
                            return Err(parsed.content);
                        }
                        full_content.push_str(&parsed.content);
                        let _ = app_handle.emit("ws-message", &parsed);
                    }
                    Err(e) => {
                        let err_msg = format!("Parse error: {}", e);
                        let _ = app_handle.emit("ws-error", &err_msg);
                        return Err(err_msg);
                    }
                }
            }
            Some(Ok(Message::Close(_))) => {
                let _ = app_handle.emit("ws-closed", ());
                break;
            }
            Some(Ok(Message::Ping(data))) => {
                if let Err(e) = write.send(Message::Pong(data)).await {
                    let err_msg = format!("Pong failed: {}", e);
                    let _ = app_handle.emit("ws-error", &err_msg);
                    return Err(err_msg);
                }
            }
            Some(Ok(Message::Pong(_))) => {}
            Some(Err(e)) => {
                let err_msg = format!("WebSocket error: {}", e);
                let _ = app_handle.emit("ws-error", &err_msg);
                return Err(err_msg);
            }
            None => {
                let _ = app_handle.emit("ws-closed", ());
                break;
            }
            _ => {}
        }
    }

    Ok(full_content)
}

#[allow(dead_code)]
pub async fn send_typing_event(
    ws_config: &WsConfig,
    is_typing: bool,
    chat_id: Option<String>,
) -> Result<(), String> {
    crate::ensure_online().map_err(|error| error.to_string())?;
    if !ws_config.url.starts_with("ws") {
        return Ok(());
    }

    let (ws_stream, _) = connect_validated(ws_config).await?;

    let (mut write, _) = ws_stream.split();

    let typing_frame = TypingFrame {
        frame_type: "typing".to_string(),
        is_typing,
        chat_id,
    };
    let typing_json = serde_json::to_string(&typing_frame)
        .map_err(|e| format!("Serialize typing error: {}", e))?;

    write
        .send(Message::Text(typing_json.into()))
        .await
        .map_err(|e| format!("Send typing failed: {}", e))?;

    Ok(())
}

use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect_validated(
    ws_config: &WsConfig,
) -> Result<
    (
        WsStream,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    String,
> {
    let endpoint = crate::endpoint_security::validate_websocket_endpoint(
        &ws_config.url,
        ws_config
            .api_key
            .as_deref()
            .is_some_and(|key| !key.is_empty()),
    )
    .await
    .map_err(|error| error.to_string())?;
    let tcp = TcpStream::connect(endpoint.address)
        .await
        .map_err(|error| format!("WebSocket connection failed: {error}"))?;
    tokio_tungstenite::client_async_tls_with_config(endpoint.url.as_str(), tcp, None, None)
        .await
        .map_err(|error| format!("WebSocket handshake failed: {error}"))
}

enum WsWriterCommand {
    Send {
        message: Message,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

struct ActiveWsConnection {
    command_tx: mpsc::Sender<WsWriterCommand>,
    cancellation: CancellationToken,
    closed_rx: oneshot::Receiver<()>,
}

#[derive(Default)]
struct WsSessionState {
    generation: u64,
    active: Option<ActiveWsConnection>,
}

#[derive(Clone)]
pub struct WsSession {
    state: std::sync::Arc<Mutex<WsSessionState>>,
}

impl Default for WsSession {
    fn default() -> Self {
        WsSession {
            state: std::sync::Arc::new(Mutex::new(WsSessionState::default())),
        }
    }
}

impl WsSession {
    async fn begin_generation(&self) -> (u64, Option<ActiveWsConnection>) {
        let mut state = self.state.lock().await;
        state.generation = state.generation.wrapping_add(1).max(1);
        let generation = state.generation;
        (generation, state.active.take())
    }

    async fn install_connection(
        &self,
        generation: u64,
        active: ActiveWsConnection,
    ) -> Result<(), ActiveWsConnection> {
        let mut state = self.state.lock().await;
        if state.generation != generation || state.active.is_some() {
            return Err(active);
        }
        state.active = Some(active);
        Ok(())
    }

    async fn current_sender(&self) -> Option<(u64, mpsc::Sender<WsWriterCommand>)> {
        let state = self.state.lock().await;
        state
            .active
            .as_ref()
            .map(|active| (state.generation, active.command_tx.clone()))
    }

    async fn is_current(&self, generation: u64) -> bool {
        let state = self.state.lock().await;
        state.generation == generation && state.active.is_some()
    }

    async fn take_if_current(&self, generation: u64) -> Option<ActiveWsConnection> {
        let mut state = self.state.lock().await;
        (state.generation == generation)
            .then(|| state.active.take())
            .flatten()
    }
}

async fn shutdown_connection(active: ActiveWsConnection) {
    active.cancellation.cancel();
    let _ = timeout(Duration::from_secs(1), active.closed_rx).await;
}

async fn send_writer_message(
    command_tx: &mpsc::Sender<WsWriterCommand>,
    message: Message,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = oneshot::channel();
    command_tx
        .send(WsWriterCommand::Send {
            message,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "WebSocket writer is no longer available".to_string())?;
    reply_rx
        .await
        .map_err(|_| "WebSocket writer stopped before sending".to_string())?
}

async fn run_ws_writer(
    mut write: futures_util::stream::SplitSink<WsStream, Message>,
    mut command_rx: mpsc::Receiver<WsWriterCommand>,
    cancellation: CancellationToken,
    closed_tx: oneshot::Sender<()>,
) {
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            command = command_rx.recv() => {
                let Some(WsWriterCommand::Send { message, reply }) = command else {
                    break;
                };
                let result = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => {
                        Err("WebSocket connection was replaced".to_string())
                    }
                    result = write.send(message) => {
                        result.map_err(|error| format!("WebSocket send failed: {error}"))
                    }
                };
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    break;
                }
            }
        }
    }

    cancellation.cancel();
    let _ = timeout(Duration::from_secs(1), write.send(Message::Close(None))).await;
    let _ = closed_tx.send(());
}

pub async fn ws_connect(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
    session: &WsSession,
) -> Result<(), String> {
    crate::ensure_online().map_err(|error| error.to_string())?;
    let (generation, previous) = session.begin_generation().await;
    if let Some(previous) = previous {
        shutdown_connection(previous).await;
    }

    let (ws_stream, _) = connect_validated(&ws_config).await?;

    let (mut write, mut read) = ws_stream.split();

    if let Some(ref key) = ws_config.api_key {
        let auth_frame = AuthFrame {
            frame_type: "auth".to_string(),
            key: key.clone(),
        };
        let auth_json =
            serde_json::to_string(&auth_frame).map_err(|e| format!("Serialize error: {}", e))?;
        write
            .send(Message::Text(auth_json.into()))
            .await
            .map_err(|e| format!("Send auth failed: {}", e))?;
    }

    let config_frame = ConfigFrame {
        frame_type: "config".to_string(),
        model: ws_config.model.clone(),
    };
    let config_json =
        serde_json::to_string(&config_frame).map_err(|e| format!("Serialize error: {}", e))?;
    write
        .send(Message::Text(config_json.into()))
        .await
        .map_err(|e| format!("Send config failed: {}", e))?;

    let cancellation = CancellationToken::new();
    let (command_tx, command_rx) = mpsc::channel(32);
    let (closed_tx, closed_rx) = oneshot::channel();
    let active = ActiveWsConnection {
        command_tx: command_tx.clone(),
        cancellation: cancellation.clone(),
        closed_rx,
    };
    if let Err(stale) = session.install_connection(generation, active).await {
        cancellation.cancel();
        drop(stale);
        let _ = timeout(Duration::from_secs(1), write.send(Message::Close(None))).await;
        return Err("WebSocket connection was superseded".to_string());
    }

    tokio::spawn(run_ws_writer(
        write,
        command_rx,
        cancellation.clone(),
        closed_tx,
    ));

    use tauri::Emitter;
    let _ = app_handle.emit(
        "ws-connected",
        &serde_json::json!({
            "model": ws_config.model,
            "url": ws_config.url
        }),
    );

    let session_clone = session.clone();
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        loop {
            let msg = tokio::select! {
                biased;
                _ = cancellation.cancelled() => break,
                msg = read.next() => msg,
            };
            let Some(msg) = msg else {
                break;
            };
            if !session_clone.is_current(generation).await {
                break;
            }
            match msg {
                Ok(Message::Text(text)) => {
                    let text_str = text.to_string();
                    if text_str.trim() == "[DONE]" {
                        let _ = app_handle_clone.emit("ws-closed", ());
                        break;
                    }
                    match serde_json::from_str::<ChatWsMessage>(&text_str) {
                        Ok(parsed) => {
                            if parsed.msg_type == "error" {
                                let _ = app_handle_clone.emit("ws-error", &parsed.content);
                                break;
                            }
                            let _ = app_handle_clone.emit("ws-message", &parsed);
                        }
                        Err(e) => {
                            let _ =
                                app_handle_clone.emit("ws-error", &format!("Parse error: {}", e));
                            break;
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    let _ = app_handle_clone.emit("ws-closed", ());
                    break;
                }
                Ok(Message::Ping(data)) => {
                    if send_writer_message(&command_tx, Message::Pong(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Message::Pong(_)) => {}
                Err(e) => {
                    let _ = app_handle_clone.emit("ws-error", &format!("WebSocket error: {}", e));
                    break;
                }
                _ => {}
            }
        }
        if let Some(active) = session_clone.take_if_current(generation).await {
            shutdown_connection(active).await;
        }
    });

    Ok(())
}

pub async fn ws_send(message: String, session: &WsSession) -> Result<(), String> {
    let (generation, command_tx) = session
        .current_sender()
        .await
        .ok_or_else(|| "WebSocket is not connected".to_string())?;
    send_writer_message(&command_tx, Message::Text(message.into())).await?;
    if !session.is_current(generation).await {
        return Err("WebSocket connection was replaced while sending".to_string());
    }
    Ok(())
}

pub async fn ws_disconnect(
    session: &WsSession,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    let (_, active) = session.begin_generation().await;
    if let Some(active) = active {
        shutdown_connection(active).await;
    }
    let _ = app_handle.emit("ws-closed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disconnected_active_connection() -> ActiveWsConnection {
        let (command_tx, command_rx) = mpsc::channel(1);
        drop(command_rx);
        let cancellation = CancellationToken::new();
        let (closed_tx, closed_rx) = oneshot::channel();
        drop(closed_tx);
        ActiveWsConnection {
            command_tx,
            cancellation,
            closed_rx,
        }
    }

    #[test]
    fn test_chat_ws_message_serialization() {
        let msg = ChatWsMessage {
            msg_type: "assistant".to_string(),
            role: "assistant".to_string(),
            content: "Hello, world!".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("Hello, world!"));
        assert!(json.contains("assistant"));

        let deserialized: ChatWsMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content, "Hello, world!");
        assert_eq!(deserialized.msg_type, "assistant");
        assert_eq!(deserialized.role, "assistant");
    }

    #[test]
    fn test_chat_ws_message_deserialize_full() {
        let json = r#"{"type":"user","role":"user","content":"What is Rust?","timestamp":"2024-06-15T10:30:00Z"}"#;
        let msg: ChatWsMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.msg_type, "user");
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "What is Rust?");
        assert_eq!(msg.timestamp, "2024-06-15T10:30:00Z");
    }

    #[test]
    fn test_ws_config_serialization() {
        let config = WsConfig {
            url: "ws://localhost:8080/chat".to_string(),
            api_key: Some("test-key".to_string()),
            model: "gpt-4o".to_string(),
            reconnect: true,
            max_reconnect_attempts: 5,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("ws://localhost:8080/chat"));
        assert!(json.contains("test-key"));
        assert!(json.contains("gpt-4o"));

        let config_no_key = WsConfig {
            url: "ws://localhost:8080/chat".to_string(),
            api_key: None,
            model: "llama3.1".to_string(),
            reconnect: true,
            max_reconnect_attempts: 5,
        };
        let json = serde_json::to_string(&config_no_key).unwrap();
        assert!(json.contains("\"api_key\":null"));
    }

    #[test]
    fn test_typing_event_serialization() {
        let typing = TypingEvent {
            user_id: "user123".to_string(),
            is_typing: true,
            chat_id: Some("chat456".to_string()),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&typing).unwrap();
        assert!(json.contains("user123"));
        assert!(json.contains("chat456"));
        assert!(json.contains("true"));

        let deserialized: TypingEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.user_id, "user123");
        assert!(deserialized.is_typing);
        assert_eq!(deserialized.chat_id, Some("chat456".to_string()));
    }

    #[test]
    fn test_ws_event_creation() {
        let msg = ChatWsMessage {
            msg_type: "assistant".to_string(),
            role: "assistant".to_string(),
            content: "Test".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let event = WsEvent::message(msg);
        assert_eq!(event.event_type, "message");
        assert_eq!(event.timestamp, "2024-01-01T00:00:00Z");

        let typing = TypingEvent {
            user_id: "user1".to_string(),
            is_typing: true,
            chat_id: None,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let event = WsEvent::typing(typing);
        assert_eq!(event.event_type, "typing");

        let event = WsEvent::connection_status("connected");
        assert_eq!(event.event_type, "connection");

        let event = WsEvent::error("Test error".to_string());
        assert_eq!(event.event_type, "error");
    }

    #[test]
    fn test_backoff_calculation() {
        let config = WsConfig::default();
        let mut connection = WebSocketConnection::new(config);

        connection.reconnect_count = 0;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(1));

        connection.reconnect_count = 1;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(2));

        connection.reconnect_count = 2;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(4));

        connection.reconnect_count = 10;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(30));
    }

    #[test]
    fn test_should_reconnect() {
        let config = WsConfig {
            reconnect: true,
            max_reconnect_attempts: 3,
            ..WsConfig::default()
        };
        let mut connection = WebSocketConnection::new(config);

        connection.reconnect_count = 0;
        assert!(connection.should_reconnect());

        connection.reconnect_count = 2;
        assert!(connection.should_reconnect());

        connection.reconnect_count = 3;
        assert!(!connection.should_reconnect());

        let config_no_reconnect = WsConfig {
            reconnect: false,
            max_reconnect_attempts: 10,
            ..WsConfig::default()
        };
        let mut connection = WebSocketConnection::new(config_no_reconnect);
        connection.reconnect_count = 0;
        assert!(!connection.should_reconnect());
    }

    #[tokio::test]
    async fn session_generations_cannot_clear_or_publish_over_newer_connections() {
        let session = WsSession::default();
        let (first_generation, previous) = session.begin_generation().await;
        assert!(previous.is_none());
        assert!(session
            .install_connection(first_generation, disconnected_active_connection())
            .await
            .is_ok());
        assert!(session.is_current(first_generation).await);

        let (second_generation, previous) = session.begin_generation().await;
        assert!(previous.is_some());
        assert!(!session.is_current(first_generation).await);
        assert!(session
            .install_connection(first_generation, disconnected_active_connection())
            .await
            .is_err());
        assert!(session
            .install_connection(second_generation, disconnected_active_connection())
            .await
            .is_ok());

        assert!(session.take_if_current(first_generation).await.is_none());
        assert!(session.is_current(second_generation).await);
        assert!(session.take_if_current(second_generation).await.is_some());
    }
}
