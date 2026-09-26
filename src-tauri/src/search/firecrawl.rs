use crate::search::{SearchError, SearchResult};

pub async fn search(
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    let api_key = config
        .get("apiKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SearchError::ConfigError("Missing API key for Firecrawl".into()))?;

    let base_url = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.firecrawl.dev/v1");

    let num = config
        .get("maxResults")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .min(20);

    let url = format!("{}/search", base_url.trim_end_matches('/'));
    let endpoint = crate::endpoint_security::validate_http_endpoint(
        &url,
        true,
        std::time::Duration::from_secs(30),
    )
    .await
    .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;

    let body = serde_json::json!({
        "query": query,
        "limit": num,
    });

    let resp = endpoint
        .client
        .post(endpoint.url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let sanitized = e.without_url().to_string();
            log::error!("Firecrawl request failed: {}", sanitized);
            SearchError::RequestFailed(sanitized)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("Firecrawl API error {}: {}", status, body);
        return Err(SearchError::RequestFailed(format!(
            "Firecrawl API error {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!("Failed to parse Firecrawl response: {}", e);
        SearchError::ParseError(e.to_string())
    })?;

    let data = json
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let search_results: Vec<SearchResult> = data
        .iter()
        .map(|item| SearchResult {
            title: item
                .get("title")
                .or_else(|| item.get("metadata").and_then(|m| m.get("title")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            url: item
                .get("url")
                .or_else(|| item.get("link"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            snippet: item
                .get("description")
                .or_else(|| item.get("snippet"))
                .or_else(|| item.get("metadata").and_then(|m| m.get("description")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .filter(|r| !r.url.is_empty())
        .collect();

    Ok(search_results)
}

pub async fn fetch(
    url: &str,
    config: &serde_json::Value,
    format: Option<&str>,
) -> Result<crate::search::UrlContent, SearchError> {
    let api_key = config
        .get("apiKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SearchError::ConfigError("Missing API key for Firecrawl".into()))?;

    let base_url = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.firecrawl.dev/v1");

    let endpoint = format!("{}/scrape", base_url.trim_end_matches('/'));
    let endpoint = crate::endpoint_security::validate_http_endpoint(
        &endpoint,
        true,
        std::time::Duration::from_secs(60),
    )
    .await
    .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;

    let requested_raw =
        format == Some("raw") || format == Some("raw_html") || format == Some("html");
    let formats = if requested_raw {
        vec!["html"]
    } else {
        vec!["markdown"]
    };

    let body = serde_json::json!({
        "url": url,
        "formats": formats,
    });

    let resp = endpoint
        .client
        .post(endpoint.url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let sanitized = e.without_url().to_string();
            log::error!("Firecrawl scrape request failed: {}", sanitized);
            SearchError::RequestFailed(sanitized)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("Firecrawl API error {}: {}", status, body);
        return Err(SearchError::RequestFailed(format!(
            "Firecrawl API error {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!("Failed to parse Firecrawl scrape response: {}", e);
        SearchError::ParseError(e.to_string())
    })?;

    let success = json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !success {
        return Err(SearchError::RequestFailed(
            "Firecrawl returned success=false".into(),
        ));
    }

    let data = json.get("data").ok_or_else(|| {
        SearchError::ParseError("Missing 'data' field in Firecrawl response".into())
    })?;

    let title = data
        .get("metadata")
        .and_then(|m| m.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or(url)
        .to_string();

    let content = if requested_raw {
        data.get("html")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        data.get("markdown")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    Ok(crate::search::UrlContent {
        url: url.to_string(),
        title,
        content,
        status: "ok".to_string(),
        error: None,
    })
}
