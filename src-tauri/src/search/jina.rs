use crate::search::{SearchError, UrlContent};
use serde_json::Value;

pub async fn fetch(url: &str, config: &serde_json::Value) -> Result<UrlContent, SearchError> {
    let api_key = config.get("apiKey").and_then(|v| v.as_str());

    let base_url = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://r.jina.ai");

    let endpoint = format!("{}/{}", base_url.trim_end_matches('/'), url);
    let endpoint = crate::endpoint_security::validate_http_endpoint(
        &endpoint,
        api_key.is_some_and(|key| !key.trim().is_empty()),
        std::time::Duration::from_secs(60),
    )
    .await
    .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;

    let mut req = endpoint
        .client
        .get(endpoint.url)
        .header("Accept", "application/json");

    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }

    let resp = req.send().await.map_err(|e| {
        let msg = e.without_url().to_string();
        log::error!("Jina scrape request failed: {}", msg);
        SearchError::RequestFailed(msg)
    })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("Jina API error {}: {}", status, body);
        return Ok(UrlContent {
            url: url.to_string(),
            title: String::new(),
            content: String::new(),
            status: "error".to_string(),
            error: Some(format!("HTTP {}", status)),
        });
    }

    let json: Value = resp.json().await.map_err(|e| {
        log::error!("Failed to parse Jina response: {}", e);
        SearchError::ParseError(e.to_string())
    })?;

    let data = json
        .get("data")
        .ok_or_else(|| SearchError::ParseError("Missing 'data' field in Jina response".into()))?;

    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(url)
        .to_string();

    let content = data
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(UrlContent {
        url: url.to_string(),
        title,
        content,
        status: "ok".to_string(),
        error: None,
    })
}
