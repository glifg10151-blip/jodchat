pub mod firecrawl;
pub mod google;
pub mod jina;
pub mod searxng;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlContent {
    pub url: String,
    pub title: String,
    pub content: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum SearchErrorResponse {
    RequestFailed { message: String },
    ParseError { message: String },
    ConfigError { message: String },
    UrlValidationError { message: String },
    HttpError { status: u16, message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Request failed: {0}")]
    RequestFailed(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Config error: {0}")]
    ConfigError(String),
    #[error("URL validation error: {0}")]
    UrlValidationError(String),
}

#[allow(dead_code)]
impl SearchError {
    pub fn to_response(&self) -> SearchErrorResponse {
        match self {
            SearchError::RequestFailed(msg) => SearchErrorResponse::RequestFailed {
                message: msg.clone(),
            },
            SearchError::ParseError(msg) => SearchErrorResponse::ParseError {
                message: msg.clone(),
            },
            SearchError::ConfigError(msg) => SearchErrorResponse::ConfigError {
                message: msg.clone(),
            },
            SearchError::UrlValidationError(msg) => SearchErrorResponse::UrlValidationError {
                message: msg.clone(),
            },
        }
    }

    pub fn to_response_with_status(&self, status: u16) -> SearchErrorResponse {
        match self {
            SearchError::RequestFailed(msg)
            | SearchError::ParseError(msg)
            | SearchError::ConfigError(msg)
            | SearchError::UrlValidationError(msg) => SearchErrorResponse::HttpError {
                status,
                message: msg.clone(),
            },
        }
    }
}

pub async fn search(
    provider: &str,
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    let default_base = match provider {
        "google" => "https://www.googleapis.com/customsearch/v1",
        "searxng" => "http://localhost:8080",
        "firecrawl" => "https://api.firecrawl.dev/v1",
        _ => "",
    };
    if !default_base.is_empty() {
        let base_url = config
            .get("baseUrl")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(default_base);
        crate::endpoint_security::validate_outbound_url(base_url, &["http", "https"])
            .await
            .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;
    }
    match provider {
        "google" => google::search(query, config).await,
        "searxng" => searxng::search(query, config).await,
        "firecrawl" => firecrawl::search(query, config).await,
        _ => Err(SearchError::ConfigError(format!(
            "Unknown search provider: {}",
            provider
        ))),
    }
}

pub async fn fetch(
    url: &str,
    provider: Option<&str>,
    config: Option<&serde_json::Value>,
    format: Option<&str>,
) -> Result<UrlContent, SearchError> {
    if let (Some(provider), Some(config)) = (provider, config) {
        let default_base = match provider {
            "firecrawl" => "https://api.firecrawl.dev/v1",
            "jina" => "https://r.jina.ai",
            _ => "",
        };
        if !default_base.is_empty() {
            let base_url = config
                .get("baseUrl")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or(default_base);
            crate::endpoint_security::validate_outbound_url(base_url, &["http", "https"])
                .await
                .map_err(|error| SearchError::UrlValidationError(error.to_string()))?;
        }
    }
    if let (Some("firecrawl"), Some(cfg)) = (provider, config) {
        return firecrawl::fetch(url, cfg, format).await;
    }
    if let (Some("jina"), Some(cfg)) = (provider, config) {
        return jina::fetch(url, cfg).await;
    }

    Err(SearchError::ConfigError(
        "No valid fetch provider selected. Please select Jina or Firecrawl.".to_string(),
    ))
}

pub fn ip_belongs_to_cidr(ip: &std::net::IpAddr, cidr: &str) -> bool {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let target_ip: std::net::IpAddr = match parts[0].parse() {
        Ok(t) => t,
        Err(_) => return false,
    };
    let prefix_len: u8 = match parts[1].parse() {
        Ok(p) => p,
        Err(_) => return false,
    };
    match (ip, target_ip) {
        (std::net::IpAddr::V4(v4), std::net::IpAddr::V4(v4_target)) => {
            if prefix_len > 32 {
                return false;
            }
            let mask = if prefix_len == 0 {
                0u32
            } else {
                !0u32 << (32 - prefix_len)
            };
            let ip_u32 = u32::from_be_bytes(v4.octets());
            let target_u32 = u32::from_be_bytes(v4_target.octets());
            (ip_u32 & mask) == (target_u32 & mask)
        }
        (std::net::IpAddr::V6(v6), std::net::IpAddr::V6(v6_target)) => {
            if prefix_len > 128 {
                return false;
            }
            let ip_u128 = u128::from_be_bytes(v6.octets());
            let target_u128 = u128::from_be_bytes(v6_target.octets());
            let mask = if prefix_len == 0 {
                0u128
            } else {
                !0u128 << (128 - prefix_len)
            };
            (ip_u128 & mask) == (target_u128 & mask)
        }
        _ => false,
    }
}

pub fn matches_wildcard(host_or_ip: &str, pattern: &str) -> bool {
    let host_chars: Vec<char> = host_or_ip.to_lowercase().chars().collect();
    let pattern_chars: Vec<char> = pattern.to_lowercase().chars().collect();

    let h_len = host_chars.len();
    let p_len = pattern_chars.len();

    let mut dp = vec![vec![false; p_len + 1]; h_len + 1];
    dp[0][0] = true;

    for j in 1..=p_len {
        if pattern_chars[j - 1] == '*' {
            dp[0][j] = dp[0][j - 1];
        }
    }

    for i in 1..=h_len {
        for j in 1..=p_len {
            if pattern_chars[j - 1] == '*' {
                dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
            } else if pattern_chars[j - 1] == host_chars[i - 1] {
                dp[i][j] = dp[i - 1][j - 1];
            }
        }
    }

    dp[h_len][p_len]
}
