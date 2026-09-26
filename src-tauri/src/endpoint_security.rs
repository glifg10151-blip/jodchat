use crate::{search, AppError, NETWORK_CONFIG};
use reqwest::redirect::Policy;
use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

const METADATA_HOSTS: &[&str] = &[
    "metadata",
    "metadata.google.internal",
    "metadata.azure.com",
    "metadata.aws.internal",
    "instance-data",
    "instance-data.ec2.internal",
];

const METADATA_IPV4: &[Ipv4Addr] = &[
    Ipv4Addr::new(169, 254, 169, 254),
    Ipv4Addr::new(100, 100, 100, 200),
    Ipv4Addr::new(168, 63, 129, 16),
];

const METADATA_IPV6: &[Ipv6Addr] = &[
    Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254),
    Ipv6Addr::new(0xfd20, 0x00ce, 0, 0, 0, 0, 0, 0x0254),
];

// These rules shipped as editable defaults before intrinsic destination checks
// existed. Ignore them as custom rules so an exact local grant can replace the
// legacy blanket entry without weakening the immutable baseline.
const LEGACY_INTRINSIC_RULES: &[&str] = &[
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.azure.com",
    "100.100.100.200",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
];

#[derive(Debug)]
pub struct ValidatedEndpoint {
    pub url: url::Url,
    pub addresses: Vec<SocketAddr>,
    pub has_exact_local_grant: bool,
    policy_identity: String,
}

fn normalized_host(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

fn effective_port(url: &url::Url) -> Option<u16> {
    url.port_or_known_default().or_else(|| match url.scheme() {
        "ws" => Some(80),
        "wss" => Some(443),
        _ => None,
    })
}

fn endpoint_origin(url: &url::Url) -> Option<(String, String, u16)> {
    Some((
        url.scheme().to_ascii_lowercase(),
        normalized_host(url.host_str()?),
        effective_port(url)?,
    ))
}

fn is_metadata_host(host: &str) -> bool {
    let host = normalized_host(host);
    METADATA_HOSTS
        .iter()
        .any(|metadata| host == *metadata || host.ends_with(&format!(".{metadata}")))
}

fn ipv4_is_shared(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn ipv6_is_unique_local(address: Ipv6Addr) -> bool {
    address.octets()[0] & 0xfe == 0xfc
}

fn is_permanently_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => address.octets()[0] == 0 || METADATA_IPV4.contains(&address),
        IpAddr::V6(address) => {
            address.is_unspecified()
                || METADATA_IPV6.contains(&address)
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_permanently_forbidden_ip(IpAddr::V4(mapped)))
        }
    }
}

pub fn is_intrinsic_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            address.is_loopback()
                || address.is_private()
                || address.is_link_local()
                || ipv4_is_shared(address)
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unicast_link_local()
                || ipv6_is_unique_local(address)
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_intrinsic_local_ip(IpAddr::V4(mapped)))
        }
    }
}

fn is_exact_local_grant(url: &url::Url, grants: &[String]) -> bool {
    let Some(origin) = endpoint_origin(url) else {
        return false;
    };
    grants.iter().any(|grant| {
        url::Url::parse(grant)
            .ok()
            .and_then(|parsed| endpoint_origin(&parsed))
            .is_some_and(|grant_origin| grant_origin == origin)
    })
}

fn is_legacy_intrinsic_rule(rule: &str) -> bool {
    LEGACY_INTRINSIC_RULES
        .iter()
        .any(|legacy| rule.eq_ignore_ascii_case(legacy))
}

fn custom_host_is_blocked(host: &str, rules: &[String]) -> bool {
    let host = normalized_host(host);
    rules.iter().any(|rule| {
        if is_legacy_intrinsic_rule(rule) || rule.contains('/') {
            return false;
        }
        let normalized_rule = normalized_host(rule);
        if rule.contains('*') {
            search::matches_wildcard(&host, &normalized_rule)
        } else {
            host == normalized_rule || host.ends_with(&format!(".{normalized_rule}"))
        }
    })
}

fn custom_ip_is_blocked(ip: IpAddr, rules: &[String]) -> bool {
    rules
        .iter()
        .filter(|rule| !is_legacy_intrinsic_rule(rule))
        .any(|rule| {
            if rule.contains('/') {
                search::ip_belongs_to_cidr(&ip, rule)
            } else if rule.contains('*') {
                search::matches_wildcard(&ip.to_string(), rule)
            } else {
                rule.parse::<IpAddr>().is_ok_and(|blocked| blocked == ip)
            }
        })
}

pub fn validate_local_grant(value: &str) -> Result<(), String> {
    let parsed =
        url::Url::parse(value).map_err(|_| "Local grants must be valid URLs".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "ws" | "wss")
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.host_str().is_none()
        || effective_port(&parsed).is_none()
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "Local grants must be HTTP(S) or WS(S) origins without credentials, paths, queries, or fragments"
                .to_string(),
        );
    }
    let host = parsed.host_str().expect("host was validated");
    if is_metadata_host(host) {
        return Err("Cloud metadata endpoints cannot be granted".to_string());
    }
    if parsed
        .host()
        .and_then(|host| match host {
            url::Host::Ipv4(address) => Some(IpAddr::V4(address)),
            url::Host::Ipv6(address) => Some(IpAddr::V6(address)),
            url::Host::Domain(_) => None,
        })
        .is_some_and(is_permanently_forbidden_ip)
    {
        return Err("Unspecified and cloud metadata addresses cannot be granted".to_string());
    }
    Ok(())
}

pub async fn validate_outbound_url(
    raw_url: &str,
    allowed_schemes: &[&str],
) -> Result<ValidatedEndpoint, AppError> {
    let parsed = url::Url::parse(raw_url)
        .map_err(|error| AppError::UrlValidationError(format!("Invalid endpoint URL: {error}")))?;
    if !allowed_schemes.contains(&parsed.scheme())
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint must use one of these schemes without embedded credentials: {}",
            allowed_schemes.join(", ")
        )));
    }
    let host = parsed.host_str().ok_or_else(|| {
        AppError::UrlValidationError("Endpoint must include a hostname".to_string())
    })?;
    if is_metadata_host(host) {
        return Err(AppError::UrlValidationError(
            "Cloud metadata endpoints are always blocked".to_string(),
        ));
    }

    let config = {
        NETWORK_CONFIG
            .read()
            .map_err(|_| {
                AppError::UrlValidationError(
                    "Network policy is unavailable; outbound endpoint validation failed closed"
                        .to_string(),
                )
            })?
            .clone()
    };
    if custom_host_is_blocked(host, &config.blocked_hosts) {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint host '{host}' is blocked by a custom network rule"
        )));
    }

    let port = effective_port(&parsed)
        .ok_or_else(|| AppError::UrlValidationError("Endpoint port is unknown".to_string()))?;
    let addresses: Vec<_> = match parsed.host() {
        Some(url::Host::Ipv4(address)) => vec![SocketAddr::new(IpAddr::V4(address), port)],
        Some(url::Host::Ipv6(address)) => vec![SocketAddr::new(IpAddr::V6(address), port)],
        Some(url::Host::Domain(domain)) => tokio::net::lookup_host((domain, port))
            .await
            .map_err(|error| {
                AppError::UrlValidationError(format!(
                    "Failed to resolve endpoint '{host}': {error}"
                ))
            })?
            .collect(),
        None => Vec::new(),
    };
    if addresses.is_empty() {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint '{host}' did not resolve to an address"
        )));
    }

    let local_granted = is_exact_local_grant(&parsed, &config.allowed_local_endpoints);
    for address in &addresses {
        let ip = address.ip();
        if is_permanently_forbidden_ip(ip) {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to an unspecified or cloud metadata address"
            )));
        }
        if custom_ip_is_blocked(ip, &config.blocked_hosts) {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to an address blocked by a custom network rule"
            )));
        }
        if is_intrinsic_local_ip(ip) && !local_granted {
            return Err(AppError::UrlValidationError(format!(
                "Endpoint '{host}' resolves to a local, private, shared, or link-local address. Add the exact origin '{}' to Local endpoint grants in Settings > Privacy to allow it.",
                endpoint_origin(&parsed)
                    .map(|(scheme, host, port)| format!("{scheme}://{host}:{port}"))
                    .unwrap_or_else(|| raw_url.to_string())
            )));
        }
    }

    Ok(ValidatedEndpoint {
        url: parsed,
        addresses,
        has_exact_local_grant: local_granted,
        policy_identity: serde_json::to_string(&config)
            .map_err(|error| AppError::ConfigIo(error.to_string()))?,
    })
}

const MAX_PROVIDER_ERROR_CHARS: usize = 512;

fn redact_json_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let key = key.to_ascii_lowercase();
                if [
                    "key",
                    "token",
                    "secret",
                    "password",
                    "authorization",
                    "cookie",
                ]
                .iter()
                .any(|sensitive| key.contains(sensitive))
                {
                    *value = serde_json::Value::String("[REDACTED]".to_string());
                } else {
                    redact_json_secrets(value);
                }
            }
        }
        serde_json::Value::Array(values) => values.iter_mut().for_each(redact_json_secrets),
        _ => {}
    }
}

pub(crate) fn sanitize_provider_error(body: &str) -> String {
    let cleaned = if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(body) {
        redact_json_secrets(&mut json);
        serde_json::to_string(&json)
            .unwrap_or_else(|_| "Provider returned an invalid error body".to_string())
    } else {
        let bearer = regex::Regex::new("(?i)bearer\\s+[a-z0-9._~+/-]+")
            .expect("static provider-error redaction regex");
        bearer.replace_all(body, "Bearer [REDACTED]").into_owned()
    };
    let mut chars = cleaned
        .chars()
        .filter(|character| !character.is_control() || *character == '\n');
    let preview: String = chars.by_ref().take(MAX_PROVIDER_ERROR_CHARS).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

pub struct ValidatedHttpEndpoint {
    pub url: url::Url,
    pub client: reqwest::Client,
}

pub struct ValidatedWebSocketEndpoint {
    pub url: url::Url,
    pub address: SocketAddr,
}

fn allows_plaintext_local_transport(has_exact_local_grant: bool, addresses: &[SocketAddr]) -> bool {
    // An exact origin grant is the single user authorization for local
    // transport. Requiring every resolved address to be local prevents a
    // hostname with mixed public/private DNS results from using the exception.
    has_exact_local_grant
        && !addresses.is_empty()
        && addresses
            .iter()
            .all(|address| is_intrinsic_local_ip(address.ip()))
}

async fn parse_and_resolve(
    raw_url: &str,
    allowed_schemes: &[&str],
    has_secret: bool,
) -> Result<(url::Url, String, Vec<SocketAddr>, String), AppError> {
    let validated = validate_outbound_url(raw_url, allowed_schemes).await?;
    let host = validated
        .url
        .host_str()
        .ok_or_else(|| {
            AppError::UrlValidationError("Endpoint must include a hostname".to_string())
        })?
        .to_string();
    let is_plaintext = matches!(validated.url.scheme(), "http" | "ws");
    if is_plaintext
        && !allows_plaintext_local_transport(validated.has_exact_local_grant, &validated.addresses)
    {
        let reason = if has_secret {
            "Credentials may only use plaintext transport to an exact local endpoint grant"
        } else {
            "Plaintext transport is only allowed for an exact local endpoint grant"
        };
        return Err(AppError::UrlValidationError(reason.to_string()));
    }

    Ok((
        validated.url,
        host,
        validated.addresses,
        validated.policy_identity,
    ))
}

pub async fn validate_http_endpoint(
    raw_url: &str,
    has_secret: bool,
    timeout: Duration,
) -> Result<ValidatedHttpEndpoint, AppError> {
    let (url, host, addresses, policy_identity) =
        parse_and_resolve(raw_url, &["http", "https"], has_secret).await?;
    let client = cached_http_client(&url, &host, &addresses, timeout, false, policy_identity)?;
    Ok(ValidatedHttpEndpoint { url, client })
}

/// Builds a client for responses whose total duration is not known in advance.
/// The timeout resets after every successful read, allowing an active stream to
/// continue indefinitely while still detecting a stalled connection.
pub async fn validate_streaming_http_endpoint(
    raw_url: &str,
    has_secret: bool,
    inactivity_timeout: Duration,
) -> Result<ValidatedHttpEndpoint, AppError> {
    let (url, host, addresses, policy_identity) =
        parse_and_resolve(raw_url, &["http", "https"], has_secret).await?;
    let client = cached_http_client(
        &url,
        &host,
        &addresses,
        inactivity_timeout,
        true,
        policy_identity,
    )?;
    Ok(ValidatedHttpEndpoint { url, client })
}

const MAX_CACHED_HTTP_CLIENTS: usize = 32;

#[derive(Clone, PartialEq, Eq)]
struct HttpClientKey {
    origin: String,
    addresses: Vec<SocketAddr>,
    timeout: Duration,
    streaming: bool,
    policy_identity: String,
}

#[derive(Default)]
struct HttpClientCache {
    entries: VecDeque<(HttpClientKey, reqwest::Client)>,
}

impl HttpClientCache {
    fn get_or_build(
        &mut self,
        key: HttpClientKey,
        build: impl FnOnce() -> Result<reqwest::Client, AppError>,
    ) -> Result<reqwest::Client, AppError> {
        if let Some(index) = self
            .entries
            .iter()
            .position(|(candidate, _)| candidate == &key)
        {
            if let Some(entry) = self.entries.remove(index) {
                let client = entry.1.clone();
                self.entries.push_back(entry);
                return Ok(client);
            }
        }
        let client = build()?;
        if self.entries.len() >= MAX_CACHED_HTTP_CLIENTS {
            self.entries.pop_front();
        }
        self.entries.push_back((key, client.clone()));
        Ok(client)
    }
}

static HTTP_CLIENT_CACHE: LazyLock<Mutex<HttpClientCache>> =
    LazyLock::new(|| Mutex::new(HttpClientCache::default()));

fn cached_http_client(
    url: &url::Url,
    host: &str,
    addresses: &[SocketAddr],
    timeout: Duration,
    streaming: bool,
    policy_identity: String,
) -> Result<reqwest::Client, AppError> {
    let mut sorted_addresses = addresses.to_vec();
    sorted_addresses.sort_unstable();
    sorted_addresses.dedup();
    let key = HttpClientKey {
        origin: url.origin().ascii_serialization(),
        addresses: sorted_addresses,
        timeout,
        streaming,
        policy_identity,
    };
    // Callers validate the current policy and all resolved addresses on every
    // request. Pool reuse is possible only for that exact validated identity.
    HTTP_CLIENT_CACHE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get_or_build(key, || {
            if streaming {
                build_streaming_http_client(host, addresses, timeout)
            } else {
                crate::client_builder()
                    .redirect(Policy::none())
                    .resolve_to_addrs(host, addresses)
                    .timeout(timeout)
                    .build()
                    .map_err(AppError::from)
            }
        })
}

fn build_streaming_http_client(
    host: &str,
    addresses: &[SocketAddr],
    inactivity_timeout: Duration,
) -> Result<reqwest::Client, AppError> {
    crate::client_builder()
        .redirect(Policy::none())
        .resolve_to_addrs(&host, &addresses)
        .connect_timeout(inactivity_timeout)
        .read_timeout(inactivity_timeout)
        .build()
        .map_err(AppError::from)
}

pub async fn validate_websocket_endpoint(
    raw_url: &str,
    has_secret: bool,
) -> Result<ValidatedWebSocketEndpoint, AppError> {
    let (url, _host, addresses, _policy_identity) =
        parse_and_resolve(raw_url, &["ws", "wss"], has_secret).await?;
    Ok(ValidatedWebSocketEndpoint {
        url,
        address: addresses[0],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn client_cache_separates_address_policy_and_timeout_changes_and_is_bounded() {
        let mut cache = HttpClientCache::default();
        let base = HttpClientKey {
            origin: "https://example.test".into(),
            addresses: vec!["203.0.113.1:443".parse().unwrap()],
            timeout: Duration::from_secs(120),
            streaming: true,
            policy_identity: "policy-a".into(),
        };
        cache
            .get_or_build(base.clone(), || Ok(reqwest::Client::new()))
            .unwrap();
        cache
            .get_or_build(base.clone(), || panic!("matching clients should be reused"))
            .unwrap();
        let mut changed = base.clone();
        changed.addresses = vec!["203.0.113.2:443".parse().unwrap()];
        let mut policy = base.clone();
        policy.policy_identity = "policy-b".into();
        let mut timeout = base.clone();
        timeout.timeout = Duration::from_secs(60);
        let mut mode = base.clone();
        mode.streaming = false;
        let mut origin = base.clone();
        origin.origin = "https://other.test".into();
        for key in [changed, policy, timeout, mode, origin] {
            let mut built = false;
            cache
                .get_or_build(key, || {
                    built = true;
                    Ok(reqwest::Client::new())
                })
                .unwrap();
            assert!(built);
        }
        for index in 0..MAX_CACHED_HTTP_CLIENTS {
            let mut key = base.clone();
            key.origin = format!("https://host-{index}.test");
            cache
                .get_or_build(key, || Ok(reqwest::Client::new()))
                .unwrap();
        }
        assert_eq!(cache.entries.len(), MAX_CACHED_HTTP_CLIENTS);
        assert!(!cache.entries.iter().any(|(key, _)| key == &base));
    }

    #[tokio::test]
    async fn cached_streaming_clients_reuse_a_connection_between_rounds() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            for _ in 0..2 {
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                    .await
                    .unwrap();
            }
        });
        let url = url::Url::parse(&format!("http://{address}/stream")).unwrap();
        for _ in 0..2 {
            let client = cached_http_client(
                &url,
                "127.0.0.1",
                &[address],
                Duration::from_secs(2),
                true,
                "connection-reuse-test".into(),
            )
            .unwrap();
            assert_eq!(
                client
                    .get(url.clone())
                    .send()
                    .await
                    .unwrap()
                    .text()
                    .await
                    .unwrap(),
                "ok"
            );
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn streaming_timeout_resets_after_each_read() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1_024];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n")
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(125)).await;
            socket.write_all(b"1\r\nb\r\n").await.unwrap();
            tokio::time::sleep(Duration::from_millis(125)).await;
            socket.write_all(b"0\r\n\r\n").await.unwrap();
        });

        let client =
            build_streaming_http_client("127.0.0.1", &[address], Duration::from_millis(200))
                .unwrap();
        let body = client
            .get(format!("http://{address}/stream"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();

        assert_eq!(body, "ab");
        server.await.unwrap();
    }

    #[test]
    fn classifies_intrinsic_local_ranges_independently_of_custom_rules() {
        for address in [
            "127.0.0.2",
            "10.2.3.4",
            "172.31.0.9",
            "192.168.1.10",
            "169.254.10.20",
            "100.64.1.2",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(is_intrinsic_local_ip(address.parse().unwrap()), "{address}");
        }
        assert!(!is_intrinsic_local_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_intrinsic_local_ip(
            "2606:4700:4700::1111".parse().unwrap()
        ));
    }

    #[test]
    fn grants_are_exact_origins_and_never_cover_metadata() {
        let grants = vec!["http://127.0.0.1:11434".to_string()];
        assert!(is_exact_local_grant(
            &url::Url::parse("http://127.0.0.1:11434/v1/chat").unwrap(),
            &grants,
        ));
        assert!(!is_exact_local_grant(
            &url::Url::parse("http://127.0.0.1:8080/v1/chat").unwrap(),
            &grants,
        ));
        assert!(validate_local_grant("http://169.254.169.254").is_err());
        assert!(validate_local_grant("http://168.63.129.16").is_err());
        assert!(validate_local_grant("http://[fd00:ec2::254]").is_err());
        assert!(validate_local_grant("http://metadata.google.internal").is_err());
    }

    #[test]
    fn plaintext_local_transport_requires_an_exact_origin_grant() {
        let tailnet_address = SocketAddr::new("100.100.0.12".parse().unwrap(), 8080);
        let loopback_address = SocketAddr::new("127.0.0.1".parse().unwrap(), 8080);
        let public_address = SocketAddr::new("203.0.113.12".parse().unwrap(), 8080);

        assert!(allows_plaintext_local_transport(true, &[tailnet_address]));
        assert!(allows_plaintext_local_transport(true, &[loopback_address]));
        assert!(!allows_plaintext_local_transport(false, &[tailnet_address]));
        assert!(!allows_plaintext_local_transport(
            true,
            &[tailnet_address, public_address]
        ));
    }

    #[test]
    fn legacy_defaults_do_not_become_removable_custom_policy() {
        assert!(!custom_host_is_blocked(
            "localhost",
            &["localhost".to_string()]
        ));
        assert!(!custom_ip_is_blocked(
            "10.0.0.1".parse().unwrap(),
            &["10.0.0.0/8".to_string()]
        ));
        assert!(custom_host_is_blocked(
            "api.example.test",
            &["*.example.test".to_string()]
        ));
    }

    #[test]
    fn provider_errors_are_bounded_and_secret_fields_are_redacted() {
        let sanitized = sanitize_provider_error(
            r#"{"error":"failed","apiKey":"secret-value","nested":{"access_token":"token-value"}}"#,
        );
        assert!(sanitized.contains("[REDACTED]"));
        assert!(!sanitized.contains("secret-value"));
        assert!(!sanitized.contains("token-value"));

        let bearer = sanitize_provider_error(&format!("Bearer secret-token {}", "x".repeat(600)));
        assert!(bearer.contains("Bearer [REDACTED]"));
        assert!(!bearer.contains("secret-token"));
        assert!(bearer.ends_with("..."));
    }
}
