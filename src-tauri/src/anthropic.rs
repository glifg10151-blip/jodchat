use crate::{is_stream_cancelled, stream_parser, wait_for_stream_cancelled, AppError, ChatMessage};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct AnthropicRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_config: Option<serde_json::Value>,
}

#[derive(Default)]
struct AnthropicThinkingParams {
    thinking: Option<serde_json::Value>,
    output_config: Option<serde_json::Value>,
    suppress_temperature: bool,
}

fn thinking_params(
    model: &str,
    thinking_level: Option<&str>,
    max_tokens: u32,
) -> AnthropicThinkingParams {
    let level = thinking_level.unwrap_or("auto").to_ascii_lowercase();
    if !matches!(level.as_str(), "off" | "low" | "medium" | "high") {
        return AnthropicThinkingParams::default();
    }

    let model = model.to_ascii_lowercase();
    let adaptive = model.contains("fable-5")
        || model.contains("mythos")
        || model.contains("-4-6")
        || model.contains("-4-7")
        || model.contains("-4-8")
        || model.contains("sonnet-5")
        || model.contains("opus-5");
    let manual = model.contains("claude-3-7")
        || (model.contains("claude-")
            && (model.contains("-4-0")
                || model.contains("-4-1")
                || model.contains("-4-5")
                || model.ends_with("-4")));

    if level == "off" {
        return if adaptive {
            AnthropicThinkingParams {
                thinking: Some(serde_json::json!({ "type": "disabled" })),
                ..Default::default()
            }
        } else {
            AnthropicThinkingParams::default()
        };
    }

    if adaptive {
        return AnthropicThinkingParams {
            thinking: Some(serde_json::json!({ "type": "adaptive" })),
            output_config: Some(serde_json::json!({ "effort": level })),
            suppress_temperature: true,
        };
    }

    if manual && max_tokens > 1024 {
        let budget_tokens = match level.as_str() {
            "low" => 1024,
            "medium" => 2048,
            _ => 4096,
        }
        .min(max_tokens - 1)
        .max(1024);
        return AnthropicThinkingParams {
            thinking: Some(
                serde_json::json!({ "type": "enabled", "budget_tokens": budget_tokens }),
            ),
            suppress_temperature: true,
            ..Default::default()
        };
    }

    AnthropicThinkingParams::default()
}

#[derive(Debug, Deserialize)]
pub struct AnthropicResponse {
    pub content: Vec<serde_json::Value>,
    pub stop_reason: Option<String>,
}

pub fn convert_tools(tools_str: &str) -> Option<Vec<serde_json::Value>> {
    let openai_tools: Vec<serde_json::Value> = serde_json::from_str(tools_str).ok()?;
    let mut anthropic_tools = Vec::new();
    for t in openai_tools {
        if let Some(func) = t.get("function") {
            let anthropic_tool = serde_json::json!({
                "name": func.get("name").cloned().unwrap_or_default(),
                "description": func.get("description").cloned().unwrap_or_default(),
                "input_schema": func.get("parameters").cloned().unwrap_or_default(),
            });
            anthropic_tools.push(anthropic_tool);
        }
    }
    (!anthropic_tools.is_empty()).then_some(anthropic_tools)
}

pub fn convert_messages(messages: Vec<ChatMessage>) -> (Option<String>, Vec<AnthropicMessage>) {
    let mut system_prompts = Vec::new();
    let mut anthropic_messages = Vec::new();

    for msg in messages {
        if msg.role == "system" {
            if let Some(val) = msg.content {
                if let Some(s) = val.as_str() {
                    system_prompts.push(s.to_string());
                }
            }
            continue;
        }

        let native_anthropic_content = msg.anthropic_content.clone();
        let mut anthropic_content = native_anthropic_content.clone().unwrap_or_default();

        if msg.role == "tool" {
            let tool_use_id = msg.tool_call_id.clone().unwrap_or_default();
            let content_str = match &msg.content {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                None => "".to_string(),
            };
            anthropic_messages.push(AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::json!([{
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content_str
                }]),
            });
            continue;
        }

        if native_anthropic_content.is_none() {
            if let Some(val) = msg.content.clone() {
                if let Some(s) = val.as_str() {
                    if !s.is_empty() {
                        anthropic_content.push(serde_json::json!({
                            "type": "text",
                            "text": s
                        }));
                    }
                } else if let Some(arr) = val.as_array() {
                    for item in arr {
                        if item.get("type").and_then(|v| v.as_str()) == Some("image_url") {
                            if let Some(img_url_obj) = item.get("image_url") {
                                if let Some(url_str) =
                                    img_url_obj.get("url").and_then(|v| v.as_str())
                                {
                                    if let Some(data) = url_str.strip_prefix("data:") {
                                        if let Some((mime, rest)) = data.split_once(';') {
                                            if let Some(base64_data) = rest.strip_prefix("base64,")
                                            {
                                                anthropic_content.push(serde_json::json!({
                                                    "type": "image",
                                                    "source": {
                                                        "type": "base64",
                                                        "media_type": mime,
                                                        "data": base64_data
                                                    }
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        } else if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                            if let Some(text) = item.get("text") {
                                anthropic_content.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                    }
                }
            }

            if let Some(tool_calls) = msg.tool_calls.clone() {
                for tc in tool_calls {
                    let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                        .unwrap_or(serde_json::json!({}));
                    anthropic_content.push(serde_json::json!({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.function.name,
                        "input": input
                    }));
                }
            }
        }

        let content_json = if native_anthropic_content.is_some()
            || (anthropic_content.is_empty() && msg.role == "assistant" && msg.tool_calls.is_some())
        {
            serde_json::Value::Array(anthropic_content)
        } else if anthropic_content.len() == 1
            && anthropic_content[0].get("type").and_then(|v| v.as_str()) == Some("text")
        {
            anthropic_content[0]
                .get("text")
                .cloned()
                .unwrap_or(serde_json::Value::String("".to_string()))
        } else {
            serde_json::Value::Array(anthropic_content)
        };

        anthropic_messages.push(AnthropicMessage {
            role: msg.role,
            content: content_json,
        });
    }

    // Merge consecutive messages of the same role
    let mut merged: Vec<AnthropicMessage> = Vec::new();
    for msg in anthropic_messages {
        if let Some(last) = merged.last_mut() {
            if last.role == msg.role {
                let mut last_content = match last.content.clone() {
                    serde_json::Value::String(s) => {
                        vec![serde_json::json!({"type": "text", "text": s})]
                    }
                    serde_json::Value::Array(arr) => arr,
                    _ => vec![],
                };
                let msg_content = match msg.content {
                    serde_json::Value::String(s) => {
                        vec![serde_json::json!({"type": "text", "text": s})]
                    }
                    serde_json::Value::Array(arr) => arr,
                    _ => vec![],
                };
                last_content.extend(msg_content);
                last.content = serde_json::Value::Array(last_content);
                continue;
            }
        }
        merged.push(msg);
    }

    let system_opt = if system_prompts.is_empty() {
        None
    } else {
        Some(system_prompts.join("\n\n"))
    };

    (system_opt, merged)
}

pub struct AnthropicEndpoint {
    pub api_url: String,
    pub api_key: String,
    pub client: reqwest::Client,
}

pub async fn chat_completion_anthropic(
    endpoint: AnthropicEndpoint,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    let AnthropicEndpoint {
        api_url,
        api_key,
        client,
    } = endpoint;
    let (system, anthropic_messages) = convert_messages(messages);

    let max_tokens = max_tokens.unwrap_or(4096);
    let thinking = thinking_params(&model, thinking_level.as_deref(), max_tokens);
    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens,
        temperature: (!thinking.suppress_temperature).then_some(temperature),
        stream: false,
        tools: None,
        thinking: thinking.thinking,
        output_config: thinking.output_config,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("chat_completion API error {}: {}", status, body);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body),
        });
    }

    let anthropic_resp: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(e.to_string()))?;

    let mut full_text = String::new();
    for c in anthropic_resp.content {
        if c.get("type").and_then(|value| value.as_str()) == Some("text") {
            if let Some(t) = c.get("text").and_then(|value| value.as_str()) {
                full_text.push_str(t);
            }
        }
    }

    Ok(full_text)
}

#[allow(clippy::too_many_arguments)]
pub async fn chat_completion_tools_anthropic(
    api_url: String,
    api_key: String,
    client: reqwest::Client,
    model: String,
    messages: Vec<ChatMessage>,
    tools_str: String,
    temperature: f64,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    let (system, anthropic_messages) = convert_messages(messages);
    let tools = convert_tools(&tools_str);

    let max_tokens = max_tokens.unwrap_or(4096);
    let thinking = thinking_params(&model, thinking_level.as_deref(), max_tokens);
    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens,
        temperature: (!thinking.suppress_temperature).then_some(temperature),
        stream: false,
        tools,
        thinking: thinking.thinking,
        output_config: thinking.output_config,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("chat_completion_tools API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let anthropic_resp: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(e.to_string()))?;

    let mut full_text = String::new();
    let mut full_reasoning = String::new();
    let mut tool_calls = Vec::new();
    let native_content = anthropic_resp.content.clone();

    for c in anthropic_resp.content {
        let content_type = c.get("type").and_then(|value| value.as_str());
        if content_type == Some("text") {
            if let Some(t) = c.get("text").and_then(|value| value.as_str()) {
                full_text.push_str(t);
            }
        } else if content_type == Some("thinking") {
            if let Some(thinking) = c.get("thinking").and_then(|value| value.as_str()) {
                full_reasoning.push_str(thinking);
            }
        } else if content_type == Some("tool_use") {
            if let (Some(id), Some(name), Some(input)) = (
                c.get("id").and_then(|value| value.as_str()),
                c.get("name").and_then(|value| value.as_str()),
                c.get("input"),
            ) {
                tool_calls.push(serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": input.to_string()
                    }
                }));
            }
        }
    }

    let openai_response = serde_json::json!({
        "choices": [{
            "finish_reason": anthropic_resp.stop_reason,
            "message": {
                "content": if full_text.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(full_text) },
                "reasoning": if full_reasoning.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(full_reasoning) },
                "tool_calls": if tool_calls.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(tool_calls) },
                "anthropic_content": native_content
            }
        }]
    });

    Ok(openai_response.to_string())
}

#[allow(clippy::too_many_arguments)]
pub async fn chat_stream_anthropic(
    api_url: String,
    api_key: String,
    client: reqwest::Client,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream_id: String,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let (system, anthropic_messages) = convert_messages(messages);

    let max_tokens = max_tokens.unwrap_or(4096);
    let thinking = thinking_params(&model, thinking_level.as_deref(), max_tokens);
    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens,
        temperature: (!thinking.suppress_temperature).then_some(temperature),
        stream: true,
        tools: None,
        thinking: thinking.thinking,
        output_config: thinking.output_config,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let parser = stream_parser::AnthropicSseParser::new();
    let resp = tokio::select! {
        result = request.send() => result?,
        _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize()),
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = tokio::select! {
            result = resp.text() => result.unwrap_or_default(),
            _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize()),
        };
        let body_str = crate::endpoint_security::sanitize_provider_error(&body_str);
        log::error!("chat_stream API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut parser = parser;

    loop {
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize());
        }

        let chunk_result = tokio::select! {
            chunk = stream.next() => match chunk {
                Some(result) => result,
                None => break,
            },
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                continue;
            }
        };

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize());
        }
        parser.push_bytes(&chunk);
        parser.process_lines(|content, is_reasoning| {
            if is_reasoning {
                stream_parser::emit_stream_reasoning_chunk(&app, &stream_id, content);
            } else {
                stream_parser::emit_stream_chunk(&app, &stream_id, content);
            }
        });
        match parser.terminal().clone() {
            stream_parser::AnthropicStreamTerminal::Streaming => {}
            stream_parser::AnthropicStreamTerminal::Complete => break,
            stream_parser::AnthropicStreamTerminal::Error(message) => {
                return Err(AppError::StreamError(message));
            }
        }
    }

    if matches!(
        parser.terminal(),
        stream_parser::AnthropicStreamTerminal::Streaming
    ) {
        return Err(AppError::StreamError(
            "Anthropic stream ended before message_stop.".to_string(),
        ));
    }
    Ok(parser.finalize())
}

#[allow(clippy::too_many_arguments)]
pub async fn chat_stream_tools_anthropic(
    api_url: String,
    api_key: String,
    client: reqwest::Client,
    model: String,
    messages: Vec<ChatMessage>,
    tools_str: String,
    temperature: f64,
    stream_id: String,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let (system, anthropic_messages) = convert_messages(messages);
    let tools = convert_tools(&tools_str);

    let max_tokens = max_tokens.unwrap_or(4096);
    let thinking = thinking_params(&model, thinking_level.as_deref(), max_tokens);
    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens,
        temperature: (!thinking.suppress_temperature).then_some(temperature),
        stream: true,
        tools,
        thinking: thinking.thinking,
        output_config: thinking.output_config,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let parser = stream_parser::AnthropicSseParser::new();
    let resp = tokio::select! {
        result = request.send() => result?,
        _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize_tools()),
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = tokio::select! {
            result = resp.text() => result.unwrap_or_default(),
            _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize_tools()),
        };
        let body_str = crate::endpoint_security::sanitize_provider_error(&body_str);
        log::error!("chat_stream_tools API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut parser = parser;

    loop {
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize_tools());
        }

        let chunk_result = tokio::select! {
            chunk = stream.next() => match chunk {
                Some(result) => result,
                None => break,
            },
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                continue;
            }
        };

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize_tools());
        }
        parser.push_bytes(&chunk);
        parser.process_lines(|content, is_reasoning| {
            if is_reasoning {
                stream_parser::emit_stream_reasoning_chunk(&app, &stream_id, content);
            } else {
                stream_parser::emit_stream_chunk(&app, &stream_id, content);
            }
        });
        match parser.terminal().clone() {
            stream_parser::AnthropicStreamTerminal::Streaming => {}
            stream_parser::AnthropicStreamTerminal::Complete => break,
            stream_parser::AnthropicStreamTerminal::Error(message) => {
                return Err(AppError::StreamError(message));
            }
        }
    }

    if matches!(
        parser.terminal(),
        stream_parser::AnthropicStreamTerminal::Streaming
    ) {
        return Err(AppError::StreamError(
            "Anthropic tool stream ended before message_stop.".to_string(),
        ));
    }
    Ok(parser.finalize_tools())
}

pub async fn check_api_anthropic(
    api_url: String,
    api_key: String,
    client: reqwest::Client,
) -> Result<bool, AppError> {
    let body = AnthropicRequest {
        model: "claude-3-haiku-20240307".to_string(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: serde_json::Value::String("hello".to_string()),
        }],
        system: None,
        max_tokens: 1,
        temperature: Some(0.0),
        stream: false,
        tools: None,
        thinking: None,
        output_config: None,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;
    if !resp.status().is_success() {
        return Err(AppError::ApiError {
            status: resp.status().as_u16(),
            message: "Connection check was rejected by the provider".to_string(),
        });
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tool_list_is_omitted_for_finalization() {
        assert!(convert_tools("[]").is_none());
    }

    #[test]
    fn native_assistant_content_is_replayed_without_reconstruction() {
        let native = vec![
            serde_json::json!({
                "type": "thinking",
                "thinking": "analysis",
                "signature": "signed"
            }),
            serde_json::json!({
                "type": "tool_use",
                "id": "toolu_1",
                "name": "lookup",
                "input": {"query": "weather"}
            }),
        ];
        let message = ChatMessage {
            role: "assistant".to_string(),
            content: Some(serde_json::Value::String(
                "This must not be duplicated.".to_string(),
            )),
            tool_calls: None,
            tool_call_id: None,
            name: None,
            responses_output: None,
            anthropic_content: Some(native.clone()),
            reasoning_content: None,
            reasoning_details: None,
            reasoning: None,
        };

        let (_, converted) = convert_messages(vec![message]);

        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].content, serde_json::Value::Array(native));
    }
}
