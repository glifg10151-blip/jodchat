use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub const DEFAULT_GITHUB_CLIENT_ID: &str = "Ov23liEBjp5NydEwaPFX";
pub const DEFAULT_GITHUB_SCOPE: &str = "repo,read:user,workflow";

pub const DEFAULT_LINEAR_CLIENT_ID: &str = "4c8cf80a34931c6e5b6338c9df74f1f8";
pub const DEFAULT_LINEAR_SCOPE: &str = "read,write,issues:create";

pub const DEFAULT_SPOTIFY_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
pub const DEFAULT_SPOTIFY_SCOPE: &str = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-read-playback-position user-top-read user-library-read user-library-modify user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubDeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubDeviceTokenResponse {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OAuthCallbackResponse {
    pub code: String,
    pub state: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub scope: Option<serde_json::Value>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[tauri::command]
pub async fn github_start_device_flow(
    client_id: Option<String>,
    scope: Option<String>,
) -> Result<GitHubDeviceCodeResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GITHUB_CLIENT_ID.to_string());
    let sc = scope.unwrap_or_else(|| DEFAULT_GITHUB_SCOPE.to_string());

    let payload = serde_json::json!({
        "client_id": cid,
        "scope": sc
    });

    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Failed to reach GitHub Device Code API: {e}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "GitHub Device Code request failed with HTTP {status}: {body}"
        )));
    }

    let result: GitHubDeviceCodeResponse = response.json().await.map_err(|e| {
        AppError::ParseError(format!("Failed to parse GitHub Device Code response: {e}"))
    })?;

    Ok(result)
}

#[tauri::command]
pub async fn github_poll_device_token(
    client_id: Option<String>,
    device_code: String,
) -> Result<GitHubDeviceTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GITHUB_CLIENT_ID.to_string());

    let payload = serde_json::json!({
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    });

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Failed to poll GitHub Access Token API: {e}"))
        })?;

    let result: GitHubDeviceTokenResponse = response.json().await.map_err(|e| {
        AppError::ParseError(format!("Failed to parse GitHub Access Token response: {e}"))
    })?;

    Ok(result)
}

fn parse_oauth_callback(
    request_line: &str,
    expected_state: Option<&str>,
) -> Result<OAuthCallbackResponse, std::io::Error> {
    let invalid = |message: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, message);
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(invalid("Invalid OAuth callback method"));
    }
    let target = parts
        .next()
        .ok_or_else(|| invalid("Missing OAuth callback URL"))?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| invalid("Invalid OAuth callback URL"))?;
    if url.path() != "/oauth/callback" {
        return Err(invalid("Unexpected OAuth callback path"));
    }
    let mut params = HashMap::new();
    for (key, value) in url.query_pairs() {
        if params
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(invalid("Duplicate OAuth callback parameter"));
        }
    }
    let state = params.get("state").cloned();
    if let Some(expected) = expected_state {
        if state.as_deref() != Some(expected) {
            return Err(invalid(
                "OAuth state parameter mismatch (CSRF check failed)",
            ));
        }
    }
    if params.contains_key("error") {
        return Err(invalid(
            "Authorization was declined or cancelled. No connection was made.",
        ));
    }
    let code = params
        .remove("code")
        .filter(|code| !code.is_empty())
        .ok_or_else(|| invalid("OAuth code parameter missing in callback"))?;
    Ok(OAuthCallbackResponse { code, state })
}

struct GoogleListener {
    listener: Option<tokio::net::TcpListener>,
    cancellation: tokio_util::sync::CancellationToken,
}

static GOOGLE_LISTENERS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, GoogleListener>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn start_google_oauth_listener(session_id: String) -> Result<u16, AppError> {
    if uuid::Uuid::parse_str(&session_id).is_err() {
        return Err(AppError::RequestFailed(
            "Invalid Google authorization session".into(),
        ));
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Could not start Google authorization: {e}"))
        })?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::RequestFailed(e.to_string()))?
        .port();
    let mut sessions = GOOGLE_LISTENERS
        .lock()
        .map_err(|_| AppError::RequestFailed("Google authorization unavailable".into()))?;
    if sessions.len() >= 8 || sessions.contains_key(&session_id) {
        return Err(AppError::RequestFailed(
            "Google authorization already in progress".into(),
        ));
    }
    sessions.insert(
        session_id,
        GoogleListener {
            listener: Some(listener),
            cancellation: tokio_util::sync::CancellationToken::new(),
        },
    );
    Ok(port)
}

#[tauri::command]
pub async fn wait_google_oauth_callback(
    session_id: String,
    expected_state: String,
) -> Result<OAuthCallbackResponse, AppError> {
    let (listener, cancellation) = {
        let mut sessions = GOOGLE_LISTENERS
            .lock()
            .map_err(|_| AppError::RequestFailed("Google authorization unavailable".into()))?;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| AppError::RequestFailed("Google authorization was cancelled".into()))?;
        let listener = session.listener.take().ok_or_else(|| {
            AppError::RequestFailed("Google authorization already waiting".into())
        })?;
        (listener, session.cancellation.clone())
    };
    let result = tokio::select! {
        _ = cancellation.cancelled() => Err(AppError::RequestFailed("Google authorization was cancelled".into())),
        result = receive_oauth_callback(listener, Some(expected_state)) => result,
    };
    if let Ok(mut sessions) = GOOGLE_LISTENERS.lock() {
        sessions.remove(&session_id);
    }
    result
}

#[tauri::command]
pub fn cancel_google_oauth_listener(session_id: String) -> Result<(), AppError> {
    let mut sessions = GOOGLE_LISTENERS
        .lock()
        .map_err(|_| AppError::RequestFailed("Google authorization unavailable".into()))?;
    if let Some(session) = sessions.remove(&session_id) {
        session.cancellation.cancel();
    }
    Ok(())
}

/// Starts a temporary local loopback HTTP listener to catch the OAuth authorization callback redirect.
#[tauri::command]
pub async fn listen_oauth_callback(
    port: u16,
    expected_state: Option<String>,
) -> Result<OAuthCallbackResponse, AppError> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!(
                "Failed to bind local OAuth loopback on port {port}: {e}"
            ))
        })?;

    receive_oauth_callback(listener, expected_state).await
}

async fn receive_oauth_callback(
    listener: tokio::net::TcpListener,
    expected_state: Option<String>,
) -> Result<OAuthCallbackResponse, AppError> {
    // 120-second timeout for user to approve in browser
    let accept_future = async {
        let (mut stream, _) = listener.accept().await?;
        let (reader, mut writer) = stream.split();
        let mut buf_reader = BufReader::new(reader);
        let mut request_line = String::new();
        (&mut buf_reader)
            .take(8193)
            .read_line(&mut request_line)
            .await?;
        if request_line.len() > 8192 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "OAuth callback too large",
            ));
        }

        let result = parse_oauth_callback(&request_line, expected_state.as_deref());
        let (status, body) = if result.is_ok() {
            (
                "200 OK",
                "Authorization received. Return to Sythoria to finish connecting.",
            )
        } else {
            (
                "400 Bad Request",
                "Authorization could not be completed. Return to Sythoria for details.",
            )
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = writer.write_all(response.as_bytes()).await;
        let _ = writer.flush().await;
        result
    };

    let result = tokio::time::timeout(std::time::Duration::from_secs(120), accept_future)
        .await
        .map_err(|_| {
            AppError::RequestFailed(
                "OAuth authorization timed out. Please try connecting again.".to_string(),
            )
        })?
        .map_err(|e| AppError::RequestFailed(format!("OAuth loopback error: {e}")))?;

    Ok(result)
}

/// Exchanges authorization code + PKCE code_verifier for a Linear access token.
#[tauri::command]
pub async fn linear_exchange_token(
    client_id: Option<String>,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<LinearTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_LINEAR_CLIENT_ID.to_string());

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code={}&code_verifier={}",
        urlencoding::encode(&cid),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code),
        urlencoding::encode(&code_verifier)
    );

    let response = client
        .post("https://api.linear.app/oauth/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Failed to reach Linear OAuth token API: {e}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Linear token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: LinearTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Linear token response: {e}")))?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Linear OAuth error: {err} - {desc}"
        )));
    }

    Ok(result)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    pub id_token: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleClientStatus {
    client_id: String,
}

#[tauri::command]
pub fn get_google_oauth_client(
    app: tauri::AppHandle,
) -> Result<Option<GoogleClientStatus>, AppError> {
    Ok(
        crate::secret_storage::get_google_oauth_client(&app)?.map(|client| GoogleClientStatus {
            client_id: client.client_id.clone(),
        }),
    )
}

#[tauri::command]
pub fn save_google_oauth_client(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<(), AppError> {
    crate::secret_storage::save_google_oauth_client(
        &app,
        crate::secret_storage::GoogleOAuthClient {
            client_id: client_id.trim().into(),
            client_secret: client_secret.trim().into(),
        },
    )
}

fn resolve_google_client(
    app: &tauri::AppHandle,
    client_id: &str,
) -> Result<crate::secret_storage::GoogleOAuthClient, AppError> {
    let client = crate::secret_storage::get_google_oauth_client(app)?.ok_or_else(|| {
        AppError::RequestFailed("Set up Google Desktop app credentials first.".into())
    })?;
    if client.client_id != client_id {
        return Err(AppError::RequestFailed(
            "Google credentials changed. Start the connection again.".into(),
        ));
    }
    Ok(client)
}

/// Exchanges authorization code + PKCE code_verifier for a Google access token.
#[tauri::command]
pub async fn google_exchange_token(
    app: tauri::AppHandle,
    client_id: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<GoogleTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let credentials = resolve_google_client(&app, &client_id)?;
    let form_params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", client_id),
        ("client_secret", credentials.client_secret.clone()),
        ("redirect_uri", redirect_uri),
        ("code", code),
        ("code_verifier", code_verifier),
    ];

    let form_body = form_params
        .into_iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(&v)))
        .collect::<Vec<_>>()
        .join("&");

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Failed to reach Google OAuth token API: {e}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Google token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Google token response: {e}")))?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Google OAuth error: {err} - {desc}"
        )));
    }

    Ok(result)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleMcpGrantReference {
    pub grant_id: String,
}

/// Saves a Google OAuth grant in Sythoria's authenticated encrypted secret store.
#[tauri::command]
pub async fn save_google_mcp_tokens(
    app: tauri::AppHandle,
    client_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
) -> Result<GoogleMcpGrantReference, AppError> {
    let credentials = resolve_google_client(&app, &client_id)?;
    let expiry_date =
        chrono::Utc::now().timestamp_millis() + (expires_in.unwrap_or(3600) as i64 * 1000);
    let grant_id = crate::secret_storage::save_google_oauth_grant(
        &app,
        crate::secret_storage::GoogleOAuthGrant {
            client_id,
            client_secret: credentials.client_secret.clone(),
            access_token,
            refresh_token,
            expiry_date: Some(expiry_date),
            scope,
        },
    )?;
    Ok(GoogleMcpGrantReference { grant_id })
}

const GMAIL_VIRTUAL_FILES_PRELOAD: &str = r#"
'use strict';
const fs = require('node:fs');
const oauthPath = process.env.GMAIL_OAUTH_PATH;
const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH;
const oauthJson = process.env.SYTHORIA_GMAIL_OAUTH_JSON;
const credentialsJson = process.env.SYTHORIA_GMAIL_CREDENTIALS_JSON;

const virtualValue = (candidate) => {
  const value = String(candidate);
  if (oauthPath && value === oauthPath) return oauthJson;
  if (credentialsPath && value === credentialsPath) return credentialsJson;
  return undefined;
};
const encoded = (value, options) => {
  const buffer = Buffer.from(value, 'utf8');
  const encoding = typeof options === 'string' ? options : options && options.encoding;
  return encoding ? buffer.toString(encoding) : buffer;
};
const isVirtual = (candidate) => virtualValue(candidate) !== undefined;

const existsSync = fs.existsSync.bind(fs);
const readFileSync = fs.readFileSync.bind(fs);
const writeFileSync = fs.writeFileSync.bind(fs);
const copyFileSync = fs.copyFileSync.bind(fs);
fs.existsSync = (candidate) => isVirtual(candidate) || existsSync(candidate);
fs.readFileSync = (candidate, options) => {
  const value = virtualValue(candidate);
  return value === undefined ? readFileSync(candidate, options) : encoded(value, options);
};
fs.writeFileSync = (candidate, ...args) => isVirtual(candidate) ? undefined : writeFileSync(candidate, ...args);
fs.copyFileSync = (source, destination, ...args) => isVirtual(destination) ? undefined : copyFileSync(source, destination, ...args);

if (fs.promises) {
  const readFile = fs.promises.readFile.bind(fs.promises);
  const writeFile = fs.promises.writeFile.bind(fs.promises);
  const copyFile = fs.promises.copyFile.bind(fs.promises);
  fs.promises.readFile = async (candidate, options) => {
    const value = virtualValue(candidate);
    return value === undefined ? readFile(candidate, options) : encoded(value, options);
  };
  fs.promises.writeFile = async (candidate, ...args) => isVirtual(candidate) ? undefined : writeFile(candidate, ...args);
  fs.promises.copyFile = async (source, destination, ...args) => isVirtual(destination) ? undefined : copyFile(source, destination, ...args);
}
"#;

fn ensure_gmail_virtual_files_preload(
    app: &tauri::AppHandle,
) -> Result<std::path::PathBuf, AppError> {
    let runtime_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(format!("Failed to get app data directory: {error}")))?
        .join("google-oauth-runtime");
    std::fs::create_dir_all(&runtime_dir).map_err(|error| {
        AppError::AppPath(format!(
            "Failed to create Google OAuth runtime directory: {error}"
        ))
    })?;
    let preload_path = runtime_dir.join("virtual-google-credentials.cjs");
    crate::atomic_file::write_atomic(&preload_path, GMAIL_VIRTUAL_FILES_PRELOAD.as_bytes())
        .map_err(|error| {
            AppError::AppPath(format!("Failed to prepare Google OAuth runtime: {error}"))
        })?;
    Ok(preload_path)
}

fn append_node_require(existing: Option<&String>, preload_path: &std::path::Path) -> String {
    let escaped = preload_path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let require = format!("--require=\"{escaped}\"");
    match existing
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(existing) => format!("{existing} {require}"),
        None => require,
    }
}

pub(crate) fn prepare_google_mcp_environment(
    app: &tauri::AppHandle,
    env: &mut HashMap<String, String>,
) -> Result<(), AppError> {
    let Some(grant_id) = env
        .remove(crate::secret_storage::GOOGLE_OAUTH_GRANT_ENV)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let kind = env
        .remove(crate::secret_storage::GOOGLE_OAUTH_KIND_ENV)
        .ok_or_else(|| AppError::ConfigIo("Google plugin credential type is missing".into()))?;
    let grant =
        crate::secret_storage::get_google_oauth_grant(app, &grant_id)?.ok_or_else(|| {
            AppError::ConfigIo("Google authorization is missing. Connect the plugin again.".into())
        })?;

    env.remove("GMAIL_OAUTH_PATH");
    env.remove("GMAIL_CREDENTIALS_PATH");
    env.remove("GOOGLE_DRIVE_OAUTH_CREDENTIALS");
    env.remove("GOOGLE_DRIVE_MCP_TOKEN_PATH");
    env.remove("GOOGLE_CLIENT_SECRET");

    if kind == "workspace" {
        env.insert("GOOGLE_DRIVE_MCP_CLIENT_ID".into(), grant.client_id.clone());
        env.insert(
            "GOOGLE_DRIVE_MCP_CLIENT_SECRET".into(),
            grant.client_secret.clone(),
        );
        env.insert(
            "GOOGLE_DRIVE_MCP_ACCESS_TOKEN".into(),
            grant.access_token.clone(),
        );
        if let Some(refresh_token) = grant.refresh_token.clone() {
            env.insert("GOOGLE_DRIVE_MCP_REFRESH_TOKEN".into(), refresh_token);
        }
        return Ok(());
    }
    if kind != "gmail" {
        return Err(AppError::ConfigIo(
            "Google plugin credential type is invalid".into(),
        ));
    }

    let runtime_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(format!("Failed to get app data directory: {error}")))?
        .join("google-oauth-runtime")
        .join(&grant_id);
    let oauth_path = runtime_dir.join("gcp-oauth.keys.json");
    let credentials_path = runtime_dir.join("credentials.json");
    let oauth_json = serde_json::to_string(&serde_json::json!({
        "installed": {
            "client_id": grant.client_id,
            "client_secret": grant.client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost:3000/oauth2callback"]
        }
    }))
    .map_err(|error| {
        AppError::ParseError(format!("Failed to prepare Google OAuth client: {error}"))
    })?;
    let credentials_json = serde_json::to_string(&serde_json::json!({
        "access_token": grant.access_token,
        "refresh_token": grant.refresh_token,
        "expiry_date": grant.expiry_date,
        "scope": grant.scope,
        "token_type": "Bearer"
    }))
    .map_err(|error| {
        AppError::ParseError(format!("Failed to prepare Google OAuth grant: {error}"))
    })?;
    let preload_path = ensure_gmail_virtual_files_preload(app)?;
    let node_options = append_node_require(env.get("NODE_OPTIONS"), &preload_path);
    env.insert("NODE_OPTIONS".into(), node_options);
    env.insert(
        "GMAIL_OAUTH_PATH".into(),
        oauth_path.to_string_lossy().to_string(),
    );
    env.insert(
        "GMAIL_CREDENTIALS_PATH".into(),
        credentials_path.to_string_lossy().to_string(),
    );
    env.insert("SYTHORIA_GMAIL_OAUTH_JSON".into(), oauth_json);
    env.insert("SYTHORIA_GMAIL_CREDENTIALS_JSON".into(), credentials_json);
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SpotifyTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyMcpTokenPaths {
    pub token_path: String,
}

/// Exchanges authorization code + PKCE code_verifier for a Spotify access & refresh token.
#[tauri::command]
pub async fn spotify_exchange_token(
    client_id: Option<String>,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<SpotifyTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_SPOTIFY_CLIENT_ID.to_string());

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code={}&code_verifier={}",
        urlencoding::encode(&cid),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code),
        urlencoding::encode(&code_verifier)
    );

    let response = client
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| {
            AppError::RequestFailed(format!("Failed to reach Spotify OAuth token API: {e}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Spotify token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: SpotifyTokenResponse = response.json().await.map_err(|e| {
        AppError::ParseError(format!("Failed to parse Spotify token response: {e}"))
    })?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Spotify OAuth error: {err} - {desc}"
        )));
    }

    Ok(result)
}

/// Saves Spotify OAuth tokens into ~/.spotify-mcp/tokens.json for the spotify-mcp server.
#[tauri::command]
pub async fn save_spotify_mcp_tokens(
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
) -> Result<SpotifyMcpTokenPaths, AppError> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| AppError::AppPath("Could not determine user home directory".to_string()))?;

    let spotify_dir = std::path::PathBuf::from(home).join(".spotify-mcp");
    std::fs::create_dir_all(&spotify_dir)
        .map_err(|e| AppError::AppPath(format!("Failed to create .spotify-mcp directory: {e}")))?;

    let expires_at =
        chrono::Utc::now().timestamp_millis() + (expires_in.unwrap_or(3600) as i64 * 1000);
    let mut token_obj = serde_json::json!({
        "access_token": access_token,
        "expires_at": expires_at,
    });
    if let Some(ref rt) = refresh_token {
        token_obj["refresh_token"] = serde_json::Value::String(rt.clone());
    }

    let token_path = spotify_dir.join("tokens.json");
    crate::atomic_file::write_atomic(
        &token_path,
        serde_json::to_string_pretty(&token_obj)
            .unwrap_or_default()
            .as_bytes(),
    )
    .map_err(|e| AppError::AppPath(format!("Failed to write Spotify tokens.json: {e}")))?;

    Ok(SpotifyMcpTokenPaths {
        token_path: token_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn gmail_runtime_uses_virtual_credential_files() {
        assert!(GMAIL_VIRTUAL_FILES_PRELOAD.contains("SYTHORIA_GMAIL_OAUTH_JSON"));
        assert!(GMAIL_VIRTUAL_FILES_PRELOAD.contains("fs.readFileSync"));
        assert!(GMAIL_VIRTUAL_FILES_PRELOAD.contains("fs.writeFileSync"));
        assert!(!GMAIL_VIRTUAL_FILES_PRELOAD.contains("client_secret\":"));
    }

    #[tokio::test]
    async fn google_listener_cancellation_releases_port() {
        let id = uuid::Uuid::new_v4().to_string();
        let port = start_google_oauth_listener(id.clone()).await.unwrap();
        cancel_google_oauth_listener(id).unwrap();
        assert!(tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .is_ok());
        let id = uuid::Uuid::new_v4().to_string();
        let port = start_google_oauth_listener(id.clone()).await.unwrap();
        let waiting_id = id.clone();
        let task =
            tokio::spawn(
                async move { wait_google_oauth_callback(waiting_id, "state".into()).await },
            );
        tokio::task::yield_now().await;
        cancel_google_oauth_listener(id).unwrap();
        assert!(task.await.unwrap().is_err());
        assert!(tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .is_ok());
    }

    #[test]
    fn oauth_callback_decodes_code_and_checks_state() {
        let result = super::parse_oauth_callback(
            "GET /oauth/callback?code=4%2Fabc%2Bdef%3D&state=expected HTTP/1.1",
            Some("expected"),
        )
        .unwrap();
        assert_eq!(result.code, "4/abc+def=");
        assert!(super::parse_oauth_callback(
            "GET /oauth/callback?code=x&state=wrong HTTP/1.1",
            Some("expected")
        )
        .is_err());
        assert!(super::parse_oauth_callback(
            "GET /oauth/callback?code=x&code=y&state=expected HTTP/1.1",
            Some("expected")
        )
        .is_err());
        assert!(super::parse_oauth_callback(
            "GET /favicon.ico?code=x&state=expected HTTP/1.1",
            Some("expected")
        )
        .is_err());
    }

    #[test]
    fn oauth_callback_reports_denied_authorization() {
        let error = super::parse_oauth_callback(
            "GET /oauth/callback?error=access_denied&state=expected HTTP/1.1",
            Some("expected"),
        )
        .err()
        .unwrap();
        assert!(error.to_string().contains("declined or cancelled"));
    }

    use super::*;

    #[test]
    fn test_spotify_token_response_deserialization() {
        let json_data = r#"{
            "access_token": "mock_spotify_access_token",
            "token_type": "Bearer",
            "scope": "user-read-private playlist-read-private",
            "expires_in": 3600,
            "refresh_token": "mock_spotify_refresh_token"
        }"#;

        let res: Result<SpotifyTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_ok());
        let token = res.unwrap();
        assert_eq!(token.access_token, "mock_spotify_access_token");
        assert_eq!(
            token.refresh_token.as_deref(),
            Some("mock_spotify_refresh_token")
        );
        assert_eq!(token.expires_in, Some(3600));
        assert_eq!(token.token_type.as_deref(), Some("Bearer"));
    }

    #[test]
    fn test_spotify_token_error_deserialization() {
        let json_data = r#"{
            "error": "invalid_grant",
            "error_description": "Invalid authorization code"
        }"#;

        let res: Result<SpotifyTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_err()); // access_token is mandatory on success
    }

    #[test]
    fn test_google_token_response_deserialization() {
        let json_data = r#"{
            "access_token": "mock_google_access_token",
            "token_type": "Bearer",
            "scope": "https://www.googleapis.com/auth/drive.readonly",
            "expires_in": 3599,
            "refresh_token": "mock_google_refresh_token"
        }"#;

        let res: Result<GoogleTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_ok());
        let token = res.unwrap();
        assert_eq!(token.access_token, "mock_google_access_token");
        assert_eq!(
            token.refresh_token.as_deref(),
            Some("mock_google_refresh_token")
        );
        assert_eq!(token.expires_in, Some(3599));
        assert_eq!(token.token_type.as_deref(), Some("Bearer"));
    }

    #[test]
    fn test_google_token_error_deserialization() {
        let json_data = r#"{
            "error": "invalid_request",
            "error_description": "client_secret is missing."
        }"#;

        let res: Result<GoogleTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_err()); // access_token is mandatory on success
    }
}
