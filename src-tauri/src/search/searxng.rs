use crate::search::{SearchError, SearchResult};

pub async fn search(
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    let base = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("http://localhost:8080");

    let num = config
        .get("maxResults")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .min(20) as usize;

    let endpoint = crate::endpoint_security::validate_http_endpoint(
        base,
        config
            .get("apiKey")
            .and_then(|value| value.as_str())
            .is_some_and(|key| !key.is_empty()),
        std::time::Duration::from_secs(15),
    )
    .await
    .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;
    let url = format!(
        "{}/search?q={}&format=json",
        endpoint.url.as_str().trim_end_matches('/'),
        urlencoding::encode(query)
    );

    let mut request = endpoint.client.get(&url);

    if let Some(api_key) = config.get("apiKey").and_then(|v| v.as_str()) {
        if !api_key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
    }

    let resp = request
        .header("User-Agent", "Sythoria/0.1.0")
        .send()
        .await
        .map_err(|e| {
            let sanitized = e.without_url().to_string();
            log::error!("SearXNG request failed: {}", sanitized);
            SearchError::RequestFailed(sanitized)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = crate::endpoint_security::sanitize_provider_error(
            &resp.text().await.unwrap_or_default(),
        );
        log::error!("SearXNG API error {}: {}", status, body);
        return Err(SearchError::RequestFailed(format!(
            "SearXNG API error {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!("Failed to parse SearXNG response: {}", e);
        SearchError::ParseError(e.to_string())
    })?;

    let results = json
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let search_results: Vec<SearchResult> = results
        .iter()
        .take(num)
        .map(|item| SearchResult {
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            url: item
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            snippet: item
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .filter(|r| !r.url.is_empty())
        .collect();

    Ok(search_results)
}
