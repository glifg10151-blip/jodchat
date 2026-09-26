//! Stateless OpenAI Responses transport, adapted to the existing chat/tool-loop contract.
//! Wire format: https://developers.openai.com/api/docs/guides/migrate-to-responses
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::{stream_parser, AppError};

const MAX_EVENT_BYTES: usize = 4_000_000;
const MAX_TEXT_BYTES: usize = 1_000_000;

pub(crate) fn is_responses_endpoint(api_url: &str) -> bool {
    url::Url::parse(api_url)
        .is_ok_and(|url| url.path().trim_end_matches('/').ends_with("/responses"))
}

pub(crate) struct ResponsesEndpoint {
    pub api_url: String,
    pub api_key: String,
    pub client: reqwest::Client,
}

pub(crate) struct ResponseOptions<'a> {
    pub model: &'a str,
    pub messages: &'a [Value],
    pub tools: &'a [Value],
    pub temperature: f64,
    pub max_tokens: Option<u32>,
    pub thinking_level: Option<&'a str>,
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AppError> {
    value[key].as_str().ok_or_else(|| {
        AppError::ParseError(format!("Responses item is missing string field '{key}'"))
    })
}

pub(crate) fn chat_messages(messages: &[crate::ChatMessage]) -> Result<Vec<Value>, AppError> {
    messages
        .iter()
        .map(|message| {
            let mut value = serde_json::to_value(message)
                .map_err(|error| AppError::ParseError(error.to_string()))?;
            if let Some(output) = &message.responses_output {
                value["responses_output"] = json!(output);
            }
            Ok(value)
        })
        .collect()
}

pub(crate) fn token_count_body(
    model: &str,
    messages: &[crate::ChatMessage],
) -> Result<Value, AppError> {
    Ok(json!({"model": model, "input": convert_input(&chat_messages(messages)?)?}))
}

pub(crate) fn token_count_url(api_url: &str) -> Result<url::Url, AppError> {
    let mut url = url::Url::parse(api_url)
        .map_err(|error| AppError::UrlValidationError(error.to_string()))?;
    url.set_path(&format!(
        "{}/input_tokens",
        url.path().trim_end_matches('/')
    ));
    url.set_fragment(None);
    Ok(url)
}

fn convert_input(messages: &[Value]) -> Result<Vec<Value>, AppError> {
    let mut input = Vec::new();
    for message in messages {
        let role = required_string(message, "role")?;
        if role == "assistant" {
            if let Some(output) = message["responses_output"].as_array() {
                input.extend(output.iter().cloned());
                continue;
            }
        }
        if role == "tool" {
            let output = match &message["content"] {
                Value::String(text) => text.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            input.push(json!({"type": "function_call_output", "call_id": required_string(message, "tool_call_id")?, "output": output}));
            continue;
        }
        if !matches!(role, "system" | "developer" | "user" | "assistant") {
            return Err(AppError::ParseError(format!(
                "Unsupported Responses message role: {role}"
            )));
        }
        let content = match &message["content"] {
            Value::Null => None,
            Value::String(text) => (!text.is_empty()).then(|| json!(text)),
            Value::Array(parts) => {
                let mut converted = Vec::new();
                for part in parts {
                    match part["type"].as_str() {
                        Some("text") => converted.push(
                            json!({"type": "input_text", "text": required_string(part, "text")?}),
                        ),
                        Some("image_url") if role == "user" => {
                            let mut image = json!({"type": "input_image", "image_url": required_string(&part["image_url"], "url")?});
                            if let Some(detail) = part["image_url"].get("detail") {
                                image["detail"] = detail.clone();
                            }
                            converted.push(image);
                        }
                        _ => {
                            return Err(AppError::ParseError(
                                "Unsupported Responses content part".into(),
                            ))
                        }
                    }
                }
                (!converted.is_empty()).then(|| json!(converted))
            }
            _ => {
                return Err(AppError::ParseError(
                    "Invalid Responses message content".into(),
                ))
            }
        };
        if let Some(content) = content {
            input.push(json!({"role": role, "content": content}));
        }
        if let Some(calls) = message["tool_calls"].as_array() {
            for call in calls {
                input.push(json!({
                    "type": "function_call",
                    "call_id": required_string(call, "id")?,
                    "name": required_string(&call["function"], "name")?,
                    "arguments": required_string(&call["function"], "arguments")?,
                }));
            }
        }
    }
    Ok(input)
}

fn build_request(options: &ResponseOptions<'_>, stream: bool) -> Result<Value, AppError> {
    let mut body = json!({
        "model": options.model,
        "input": convert_input(options.messages)?,
        "stream": stream,
        "store": false,
        "include": ["reasoning.encrypted_content"],
    });
    if let Some(limit) = options.max_tokens {
        body["max_output_tokens"] = json!(limit);
    }
    let model = options.model.to_ascii_lowercase();
    let reasoning_model = ["o1", "o3", "o4", "gpt-5", "gpt-6", "gpt-oss"]
        .iter()
        .any(|prefix| model.starts_with(prefix));
    if reasoning_model {
        body["reasoning"] = if model.starts_with("o1") {
            json!({})
        } else {
            json!({"summary": "auto"})
        };
        match options.thinking_level {
            Some("off") => body["reasoning"]["effort"] = json!("none"),
            Some(level @ ("low" | "medium" | "high")) => body["reasoning"]["effort"] = json!(level),
            _ => {}
        }
    } else {
        body["temperature"] = json!(options.temperature);
    }
    if !options.tools.is_empty() {
        let mut tools = Vec::new();
        for tool in options.tools {
            let function = &tool["function"];
            let mut converted = json!({
                "type": "function",
                "name": required_string(function, "name")?,
                // Existing MCP/workspace schemas allow optional properties.
                "strict": function.get("strict").cloned().unwrap_or(json!(false)),
            });
            for key in ["description", "parameters"] {
                if let Some(value) = function.get(key) {
                    converted[key] = value.clone();
                }
            }
            tools.push(converted);
        }
        body["tools"] = json!(tools);
        body["tool_choice"] = json!("auto");
    }
    Ok(body)
}

fn normalize_response(response: &Value) -> Result<Value, AppError> {
    match response["status"].as_str() {
        Some("completed") => {}
        Some("incomplete") => {
            return Err(AppError::StreamError(format!(
                "Responses generation is incomplete: {}",
                crate::truncate_error(&response["incomplete_details"].to_string())
            )))
        }
        _ => {
            return Err(AppError::StreamError(format!(
                "Responses generation did not complete: {}",
                crate::truncate_error(&response["error"].to_string())
            )))
        }
    }
    let output = response["output"]
        .as_array()
        .ok_or_else(|| AppError::ParseError("Responses result is missing output items".into()))?;
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls = Vec::new();
    for item in output {
        match item["type"].as_str() {
            Some("message") => {
                if let Some(parts) = item["content"].as_array() {
                    for part in parts {
                        match part["type"].as_str() {
                            Some("output_text") => content.push_str(required_string(part, "text")?),
                            Some("refusal") => content.push_str(required_string(part, "refusal")?),
                            _ => {}
                        }
                    }
                }
            }
            Some("reasoning") => {
                if let Some(summary) = item["summary"].as_array() {
                    for part in summary {
                        if let Some(text) = part["text"].as_str() {
                            reasoning.push_str(text);
                        }
                    }
                }
            }
            Some("function_call") => {
                if calls.len() >= 64 {
                    return Err(AppError::ParseError(
                        "Responses tool-call limit exceeded".into(),
                    ));
                }
                calls.push(json!({
                    "id": required_string(item, "call_id")?, "type": "function",
                    "function": {"name": required_string(item, "name")?, "arguments": required_string(item, "arguments")?},
                }));
            }
            _ => {}
        }
    }
    Ok(json!({"choices": [{
        "finish_reason": if calls.is_empty() { "stop" } else { "tool_calls" },
        "message": {"role": "assistant", "content": content, "reasoning_content": reasoning,
            "tool_calls": calls, "responses_output": output}
    }]}))
}

#[derive(Default)]
struct ResponsesParser {
    buffer: Vec<u8>,
    data: String,
    text: String,
    reasoning: String,
    response: Option<Value>,
}

impl ResponsesParser {
    fn push(&mut self, bytes: &[u8], mut emit: impl FnMut(bool, &str)) -> Result<(), AppError> {
        // Process lines incrementally so network chunk boundaries (including UTF-8)
        // never change event framing or impose a limit on the whole conversation.
        for byte in bytes {
            if *byte != b'\n' {
                if self.buffer.len() + self.data.len() >= MAX_EVENT_BYTES {
                    return Err(AppError::StreamError(
                        "Responses SSE event size limit exceeded".into(),
                    ));
                }
                self.buffer.push(*byte);
                continue;
            }
            let raw = std::mem::take(&mut self.buffer);
            let line = std::str::from_utf8(&raw)
                .map_err(|error| AppError::ParseError(error.to_string()))?
                .trim_end_matches('\r');
            if line.is_empty() {
                if self.data.is_empty() {
                    continue;
                }
                let data = std::mem::take(&mut self.data);
                let event: Value = serde_json::from_str(&data)
                    .map_err(|error| AppError::ParseError(error.to_string()))?;
                self.event(&event, &mut emit)?;
                if self.response.is_some() {
                    return Ok(());
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                if !self.data.is_empty() {
                    self.data.push('\n');
                }
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            }
        }
        Ok(())
    }

    fn event(&mut self, event: &Value, emit: &mut impl FnMut(bool, &str)) -> Result<(), AppError> {
        match event["type"].as_str() {
            Some(
                "response.output_text.delta"
                | "response.refusal.delta"
                | "response.reasoning_summary_text.delta",
            ) => {
                let reasoning = event["type"] == "response.reasoning_summary_text.delta";
                let delta = required_string(event, "delta")?;
                let text = if reasoning {
                    &mut self.reasoning
                } else {
                    &mut self.text
                };
                if text.len() + delta.len() > MAX_TEXT_BYTES {
                    return Err(AppError::StreamError(
                        "Responses text size limit exceeded".into(),
                    ));
                }
                text.push_str(delta);
                emit(reasoning, delta);
            }
            Some("response.completed" | "response.incomplete" | "response.failed") => {
                // The terminal response contains all finalized items, including
                // interleaved function arguments and encrypted reasoning. Never
                // execute partial calls from argument deltas or output_item.done.
                let response = normalize_response(&event["response"])?;
                let message = &response["choices"][0]["message"];
                for (is_reasoning, key, previous) in [
                    (false, "content", &self.text),
                    (true, "reasoning_content", &self.reasoning),
                ] {
                    if let Some(suffix) = message[key]
                        .as_str()
                        .and_then(|text| text.strip_prefix(previous.as_str()))
                    {
                        if !suffix.is_empty() {
                            emit(is_reasoning, suffix);
                        }
                    }
                }
                self.response = Some(response);
            }
            Some("error") => {
                return Err(AppError::StreamError(crate::truncate_error(
                    &event.to_string(),
                )))
            }
            _ => {}
        }
        Ok(())
    }

    fn cancelled(&self) -> Value {
        json!({"choices": [{"finish_reason": null, "message": {
            "content": self.text, "reasoning_content": self.reasoning, "tool_calls": []
        }}]})
    }

    fn finish(self) -> Result<Value, AppError> {
        self.response.ok_or_else(|| {
            AppError::StreamError("Responses stream ended before a completion event.".into())
        })
    }
}

pub(crate) async fn send(
    endpoint: ResponsesEndpoint,
    options: ResponseOptions<'_>,
    stream: Option<(&tauri::AppHandle, &str)>,
) -> Result<Value, AppError> {
    let body = build_request(&options, stream.is_some())?;
    let mut request = endpoint.client.post(endpoint.api_url).json(&body);
    if !endpoint.api_key.is_empty() {
        request = request.bearer_auth(endpoint.api_key);
    }
    let mut parser = ResponsesParser::default();
    let response = if let Some((_, id)) = stream {
        tokio::select! {
            result = request.send() => result?,
            _ = crate::wait_for_stream_cancelled(id) => return Ok(parser.cancelled()),
        }
    } else {
        request.send().await?
    };
    let status = response.status();
    let mut chunks = response.bytes_stream();
    let mut bytes = Vec::new();
    loop {
        let next = if let Some((_, id)) = stream {
            tokio::select! {
                chunk = chunks.next() => chunk,
                _ = crate::wait_for_stream_cancelled(id) => return Ok(parser.cancelled()),
            }
        } else {
            chunks.next().await
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| AppError::StreamError(error.to_string()))?;
        if status.is_success() {
            if let Some((app, id)) = stream {
                parser.push(&chunk, |reasoning, text| {
                    if reasoning {
                        stream_parser::emit_stream_reasoning_chunk(app, id, text);
                    } else {
                        stream_parser::emit_stream_chunk(app, id, text);
                    }
                })?;
                if parser.response.is_some() {
                    break;
                }
                continue;
            }
        }
        if bytes.len() + chunk.len() > MAX_EVENT_BYTES {
            return Err(AppError::ParseError(
                "Responses body size limit exceeded".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(AppError::ApiError {
            status: status.as_u16(),
            message: crate::truncate_error(&String::from_utf8_lossy(&bytes)),
        });
    }
    if stream.is_some() {
        parser.finish()
    } else {
        let response = serde_json::from_slice(&bytes)
            .map_err(|error| AppError::ParseError(error.to_string()))?;
        normalize_response(&response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output() -> Vec<Value> {
        vec![
            json!({"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Checking."}],"encrypted_content":"opaque"}),
            json!({"type":"message","id":"msg_1","role":"assistant","status":"completed","phase":"commentary","content":[{"type":"output_text","text":"Hello 🌍","annotations":[]}]}),
            json!({"type":"function_call","id":"fc_1","call_id":"call_1","name":"read","arguments":"{\"path\":\"a\"}"}),
            json!({"type":"function_call","id":"fc_2","call_id":"call_2","name":"read","arguments":"{\"path\":\"b\"}"}),
        ]
    }

    fn completed() -> Value {
        json!({"status":"completed","output":output()})
    }

    fn event(value: Value) -> String {
        format!(
            "event: {}\r\ndata: {}\r\n\r\n",
            value["type"].as_str().unwrap_or("test"),
            value
        )
    }

    #[test]
    fn responses_routes_require_the_actual_path() {
        assert!(is_responses_endpoint("https://api.openai.com/v1/responses"));
        assert!(is_responses_endpoint(
            "https://custom.example/proxy/responses/?api-version=1"
        ));
        assert!(!is_responses_endpoint(
            "https://custom.example/v1/chat/completions?hint=/responses"
        ));
        assert!(!is_responses_endpoint(
            "https://responses.example/v1/messages"
        ));
        assert!(!is_responses_endpoint("not a URL"));
        assert_eq!(
            token_count_url("https://custom.example/proxy/responses/?api-version=1")
                .unwrap()
                .as_str(),
            "https://custom.example/proxy/responses/input_tokens?api-version=1"
        );
    }

    #[test]
    fn responses_request_maps_images_tools_and_stateless_options() {
        let messages = vec![
            json!({"role":"system","content":"Follow the rules"}),
            json!({"role":"user","content":[{"type":"text","text":"Describe"},{"type":"image_url","image_url":{"url":"data:image/png;base64,abc","detail":"high"}}]}),
            json!({"role":"assistant","content":null,"reasoning_content":"Do not send this field","tool_calls":[{"id":"call_1","function":{"name":"read","arguments":"{}"}}]}),
            json!({"role":"tool","tool_call_id":"call_1","content":"contents"}),
        ];
        let tools = vec![
            json!({"type":"function","function":{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"optional":{"type":"string"}},"required":[]}}}),
        ];
        let options = ResponseOptions {
            model: "gpt-5.6-sol",
            messages: &messages,
            tools: &tools,
            temperature: 0.7,
            max_tokens: Some(1234),
            thinking_level: Some("high"),
        };
        let body = build_request(&options, true).unwrap();
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_output_tokens"], 1234);
        assert_eq!(body["reasoning"], json!({"effort":"high","summary":"auto"}));
        for absent in [
            "temperature",
            "messages",
            "max_tokens",
            "max_completion_tokens",
            "reasoning_effort",
        ] {
            assert!(body.get(absent).is_none());
        }
        assert_eq!(body["input"][0], messages[0]);
        assert_eq!(
            body["input"][1]["content"][1],
            json!({"type":"input_image","image_url":"data:image/png;base64,abc","detail":"high"})
        );
        assert_eq!(
            body["input"][2],
            json!({"type":"function_call","call_id":"call_1","name":"read","arguments":"{}"})
        );
        assert_eq!(
            body["input"][3],
            json!({"type":"function_call_output","call_id":"call_1","output":"contents"})
        );
        assert_eq!(body["tools"][0]["strict"], false);
        assert_eq!(
            body["tools"][0]["parameters"],
            tools[0]["function"]["parameters"]
        );
        assert!(body["tools"][0].get("function").is_none());
    }

    #[test]
    fn responses_request_omits_unset_limits_and_reasoning_controls() {
        let options = ResponseOptions {
            model: "gpt-4.1",
            messages: &[],
            tools: &[],
            temperature: 0.4,
            max_tokens: None,
            thinking_level: None,
        };
        let body = build_request(&options, false).unwrap();
        assert_eq!(body["temperature"], 0.4);
        assert!(body.get("reasoning").is_none());
        assert!(body.get("max_output_tokens").is_none());
        assert!(body.get("tools").is_none());
        let options = ResponseOptions {
            model: "gpt-5.6-sol",
            ..options
        };
        let body = build_request(&options, true).unwrap();
        assert!(body["reasoning"].get("effort").is_none());
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn responses_output_round_trips_without_duplicating_calls_or_losing_reasoning() {
        let normalized = normalize_response(&completed()).unwrap();
        assert_eq!(normalized["choices"][0]["finish_reason"], "tool_calls");
        let message = normalized["choices"][0]["message"].clone();
        assert_eq!(message["content"], "Hello 🌍");
        assert_eq!(message["reasoning_content"], "Checking.");
        assert_eq!(message["tool_calls"][1]["id"], "call_2");
        let messages = [
            message,
            json!({"role":"tool","tool_call_id":"call_1","content":"a"}),
            json!({"role":"tool","tool_call_id":"call_2","content":"b"}),
        ];
        let replayed = convert_input(&messages).unwrap();
        assert_eq!(&replayed[..4], &output());
        assert_eq!(replayed.len(), 6);
        assert_eq!(replayed[4]["call_id"], "call_1");
        assert_eq!(replayed[5]["call_id"], "call_2");
        let structured: Vec<crate::ChatMessage> = serde_json::from_value(json!(messages)).unwrap();
        assert_eq!(
            token_count_body("gpt-5.6-sol", &structured).unwrap()["input"],
            json!(replayed)
        );
        // Responses-native fields must never leak into Chat Completions requests.
        assert!(serde_json::to_value(&structured[0])
            .unwrap()
            .get("responses_output")
            .is_none());
    }

    #[test]
    fn responses_stream_handles_utf8_fragmentation_and_authoritative_parallel_calls() {
        let transcript = format!(
            ": keepalive\r\n\r\n{}{}{}{}{}",
            event(json!({"type":"response.reasoning_summary_text.delta","delta":"Checking."})),
            event(json!({"type":"response.output_text.delta","delta":"Hello 🌍"})),
            event(
                json!({"type":"response.function_call_arguments.delta","output_index":2,"delta":"{\"path\":"})
            ),
            event(
                json!({"type":"response.function_call_arguments.delta","output_index":3,"delta":"{\"path\":"})
            ),
            event(json!({"type":"response.completed","response":completed()}))
        );
        let mut parser = ResponsesParser::default();
        let mut text = String::new();
        let mut reasoning = String::new();
        for byte in transcript.as_bytes() {
            parser
                .push(&[*byte], |is_reasoning, chunk| {
                    if is_reasoning {
                        reasoning.push_str(chunk)
                    } else {
                        text.push_str(chunk)
                    }
                })
                .unwrap();
        }
        assert_eq!(text, "Hello 🌍");
        assert_eq!(reasoning, "Checking.");
        assert_eq!(
            parser.finish().unwrap(),
            normalize_response(&completed()).unwrap()
        );
    }

    #[test]
    fn responses_stream_uses_terminal_text_when_deltas_are_absent() {
        let mut parser = ResponsesParser::default();
        let mut text = String::new();
        parser
            .push(
                event(json!({"type":"response.completed","response":completed()})).as_bytes(),
                |reasoning, delta| {
                    if !reasoning {
                        text.push_str(delta)
                    }
                },
            )
            .unwrap();
        assert_eq!(text, "Hello 🌍");
        assert!(parser.finish().is_ok());
    }

    #[test]
    fn responses_partial_calls_are_never_released_on_eof_or_cancellation() {
        let mut parser = ResponsesParser::default();
        parser
            .push(
                event(
                    json!({"type":"response.output_item.done","output_index":0,"item":output()[2]}),
                )
                .as_bytes(),
                |_, _| {},
            )
            .unwrap();
        assert_eq!(
            parser.cancelled()["choices"][0]["message"]["tool_calls"],
            json!([])
        );
        assert!(parser.finish().is_err());
    }

    #[test]
    fn responses_failures_incomplete_results_and_malformed_events_are_errors() {
        for response in [
            json!({"status":"incomplete","output":output(),"incomplete_details":{"reason":"max_output_tokens"}}),
            json!({"status":"failed","error":{"message":"failed"}}),
            json!({"status":"completed"}),
        ] {
            assert!(normalize_response(&response).is_err());
        }
        let mut parser = ResponsesParser::default();
        assert!(parser
            .push(
                event(json!({"type":"error","message":"upstream failure"})).as_bytes(),
                |_, _| {}
            )
            .is_err());
        assert!(ResponsesParser::default()
            .push(b"data: {bad json}\n\n", |_, _| {})
            .is_err());
        assert!(ResponsesParser::default()
            .push(&vec![b'x'; MAX_EVENT_BYTES + 1], |_, _| {})
            .is_err());
        assert!(ResponsesParser::default()
            .event(
                &json!({"type":"response.output_text.delta","delta":"x".repeat(MAX_TEXT_BYTES+1)}),
                &mut |_, _| {}
            )
            .is_err());
    }

    #[test]
    fn responses_refusals_are_visible_and_bad_tool_metadata_is_rejected() {
        let response = normalize_response(&json!({"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"Cannot help"}]}]})).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"], "Cannot help");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
        assert!(normalize_response(&json!({"status":"completed","output":[{"type":"function_call","name":"read","arguments":"{}"}]})).is_err());
        assert!(convert_input(&[json!({"role":"tool","content":"missing call id"})]).is_err());
    }
}
