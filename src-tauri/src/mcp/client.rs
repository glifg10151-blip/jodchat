use crate::mcp::{
    McpServerConfig, McpServerHandle, McpServerRequest, McpToolInfo, McpToolResult, MCP_SERVERS,
};
use rmcp::model::ClientInfo;
use rmcp::service::ServiceExt;
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::ClientHandler;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use zeroize::Zeroize;

fn restrict_catalog_tools(
    mut tools: Vec<McpToolInfo>,
    env: &HashMap<String, String>,
) -> Result<Vec<McpToolInfo>, String> {
    if let Some(value) = env.get("SYTHORIA_ALLOWED_TOOLS") {
        let allowed: Vec<String> = serde_json::from_str(value)
            .map_err(|_| "Invalid catalog tool permissions".to_string())?;
        tools.retain(|tool| allowed.contains(&tool.name));
        if tools.is_empty() {
            return Err(
                "The plugin does not expose any tools for the selected permissions.".into(),
            );
        }
    }
    Ok(tools)
}

struct SensitiveEnvironment(HashMap<String, String>);

impl Drop for SensitiveEnvironment {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            value.zeroize();
        }
        self.0.clear();
    }
}

/// Parent-process variables required by common cross-platform runtimes and
/// package-manager launchers. Everything else must be explicitly configured on
/// the individual MCP server; in particular, proxy, cloud, signing, and agent
/// socket variables are intentionally not inherited.
const MCP_RUNTIME_ENV_ALLOWLIST: &[&str] = &[
    // Unix runtime and locale discovery.
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    // Windows runtime, executable, profile, and temporary-directory discovery.
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "COMMONPROGRAMW6432",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "ALLUSERSPROFILE",
    "PUBLIC",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "USERNAME",
    "COMPUTERNAME",
    "USERDOMAIN",
    "NODE_PATH",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_PREFIX",
    "NPM_CONFIG_USERCONFIG",
    "NPM_CONFIG_REGISTRY",
    // Python and package-manager toolchain discovery.
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONUSERBASE",
    "UV_CACHE_DIR",
    "UV_PYTHON",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "PIP_CACHE_DIR",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "BUN_INSTALL",
];

fn is_explicit_env_key_allowed(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

#[derive(Clone)]
struct SythoriaMcpClient {
    info: ClientInfo,
}

impl ClientHandler for SythoriaMcpClient {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }
}

fn convert_tool(t: &rmcp::model::Tool) -> McpToolInfo {
    let schema_obj = t.input_schema.as_ref().clone();
    McpToolInfo {
        name: t.name.to_string(),
        description: t.description.clone().unwrap_or_default().to_string(),
        inputSchema: serde_json::Value::Object(schema_obj),
        readOnlyHint: t
            .annotations
            .as_ref()
            .and_then(|annotations| annotations.read_only_hint),
    }
}

/// Returns the trimmed executable name from a command string.
///
/// As of the stdio UX redesign, `command` holds the program/executable only
/// (e.g. `npx`, `uvx`, `/usr/local/bin/python`) — never a full command line.
/// All arguments are supplied separately via `McpServerConfig::args`.
///
/// Returns `Err` for an empty/whitespace command so callers can produce a clear
/// "command is required" message rather than a confusing spawn failure later.
fn resolve_executable_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Command is required for stdio transport".to_string());
    }
    Ok(trimmed.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

async fn find_executable(name: &str) -> String {
    if which::which(name).is_ok() {
        return name.to_string();
    }

    #[cfg(windows)]
    {
        let mut candidates = vec![name.to_string()];
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".cmd") && !lower.ends_with(".exe") && !lower.ends_with(".bat") {
            candidates.push(format!("{}.cmd", name));
            candidates.push(format!("{}.exe", name));
            candidates.push(format!("{}.bat", name));
        }

        let mut win_dirs = vec![
            std::path::PathBuf::from("C:\\Program Files\\nodejs"),
            std::path::PathBuf::from("C:\\Program Files (x86)\\nodejs"),
            std::path::PathBuf::from("C:\\Windows\\System32"),
            std::path::PathBuf::from("C:\\Windows"),
        ];
        if let Ok(appdata) = std::env::var("APPDATA") {
            win_dirs.push(std::path::PathBuf::from(appdata).join("npm"));
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let py_dir = std::path::PathBuf::from(&local_appdata)
                .join("Programs")
                .join("Python");
            if let Ok(entries) = std::fs::read_dir(&py_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.is_dir() {
                        win_dirs.push(p.join("Scripts"));
                        win_dirs.push(p);
                    }
                }
            }
            win_dirs.push(
                std::path::PathBuf::from(&local_appdata)
                    .join("Python")
                    .join("bin"),
            );
            win_dirs.push(
                std::path::PathBuf::from(&local_appdata)
                    .join("Programs")
                    .join("uv"),
            );
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let up = std::path::PathBuf::from(&userprofile);
            win_dirs.push(up.join(".cargo").join("bin"));
            win_dirs.push(up.join(".local").join("bin"));
            win_dirs.push(up.join(".bun").join("bin"));
        }

        for dir in &win_dirs {
            for cand in &candidates {
                let path = dir.join(cand);
                if path.exists() {
                    return path.to_string_lossy().to_string();
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let common_paths = [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ];

        for dir in &common_paths {
            let path = std::path::Path::new(dir).join(name);
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }

        if let Ok(home) = std::env::var("HOME") {
            let npm_paths = [
                format!("{}/.npm-global/bin", home),
                format!("{}/.local/bin", home),
                format!("{}/n/bin", home),
            ];
            for dir in &npm_paths {
                let path = std::path::Path::new(dir).join(name);
                if path.exists() {
                    return path.to_string_lossy().to_string();
                }
            }

            if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
                let nvm_bin = std::path::Path::new(&nvm_dir).join("versions").join("node");
                if let Ok(entries) = std::fs::read_dir(&nvm_bin) {
                    let mut versions: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().is_dir())
                        .collect();
                    versions.sort_by(|a, b| {
                        let a_name = a.file_name().to_string_lossy().to_string();
                        let b_name = b.file_name().to_string_lossy().to_string();
                        b_name.cmp(&a_name)
                    });
                    for version_dir in versions {
                        let bin_path = version_dir.path().join("bin").join(name);
                        if bin_path.exists() {
                            return bin_path.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }

    name.to_string()
}

fn create_shell_command(program: &str, args: &[String]) -> Command {
    let program_path = std::path::Path::new(program);
    let mut cmd = if cfg!(windows) {
        // On Windows, running `npx.cmd` directly through batch execution can fail if npm
        // fails to resolve shims via cmd.exe without PATHEXT. If `npx` or `npx.cmd` is invoked
        // and `node.exe` with `npx-cli.js` exists beside it, invoke `node.exe <npx-cli.js>` directly.
        let is_npx = program.eq_ignore_ascii_case("npx")
            || program.to_ascii_lowercase().ends_with("npx.cmd")
            || program.to_ascii_lowercase().ends_with("npx.exe");
        if is_npx {
            let mut direct_node = None;
            if program_path.is_absolute() {
                if let Some(parent) = program_path.parent() {
                    let node_exe = parent.join("node.exe");
                    let npx_cli = parent
                        .join("node_modules")
                        .join("npm")
                        .join("bin")
                        .join("npx-cli.js");
                    if node_exe.exists() && npx_cli.exists() {
                        direct_node = Some((node_exe, npx_cli));
                    }
                }
            }
            if direct_node.is_none() {
                let common_node_dirs = [
                    "C:\\Program Files\\nodejs",
                    "C:\\Program Files (x86)\\nodejs",
                ];
                for dir in &common_node_dirs {
                    let pb = std::path::PathBuf::from(dir);
                    let node_exe = pb.join("node.exe");
                    let npx_cli = pb
                        .join("node_modules")
                        .join("npm")
                        .join("bin")
                        .join("npx-cli.js");
                    if node_exe.exists() && npx_cli.exists() {
                        direct_node = Some((node_exe, npx_cli));
                        break;
                    }
                }
            }

            if let Some((node_exe, npx_cli)) = direct_node {
                let mut c = Command::new(node_exe);
                c.arg(npx_cli);
                c.args(args);
                c
            } else if program.to_ascii_lowercase().ends_with(".cmd")
                || program.to_ascii_lowercase().ends_with(".bat")
            {
                let comspec = std::env::var("COMSPEC")
                    .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".to_string());
                let mut c = Command::new(comspec);
                c.arg("/c");
                c.arg(program);
                c.args(args);
                c
            } else {
                let mut c = Command::new(program);
                c.args(args);
                c
            }
        } else if program.to_ascii_lowercase().ends_with(".cmd")
            || program.to_ascii_lowercase().ends_with(".bat")
        {
            let comspec = std::env::var("COMSPEC")
                .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".to_string());
            let mut c = Command::new(comspec);
            c.arg("/c");
            c.arg(program);
            c.args(args);
            c
        } else {
            let mut c = Command::new(program);
            c.args(args);
            c
        }
    } else {
        let mut c = Command::new(program);
        c.args(args);
        c
    };

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    // MCP stdio servers are renderer-configurable executables. Do not let them
    // implicitly inherit credentials or ambient desktop integration sockets.
    cmd.env_clear();
    for (key, value) in std::env::vars_os() {
        let normalized = key.to_string_lossy().to_ascii_uppercase();
        if MCP_RUNTIME_ENV_ALLOWLIST.contains(&normalized.as_str()) {
            cmd.env(key, value);
        }
    }

    #[cfg(windows)]
    {
        // Guarantee critical Windows environment variables for batch/cmd/node child processes
        cmd.env(
            "PATHEXT",
            std::env::var("PATHEXT").unwrap_or_else(|_| {
                ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC".to_string()
            }),
        );
        let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        cmd.env("SystemRoot", &sysroot);
        cmd.env(
            "SystemDrive",
            std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string()),
        );
        cmd.env(
            "COMSPEC",
            std::env::var("COMSPEC").unwrap_or_else(|_| format!("{}\\System32\\cmd.exe", sysroot)),
        );
        let temp = std::env::temp_dir();
        cmd.env("TEMP", &temp);
        cmd.env("TMP", &temp);
    }

    let current_path = std::env::vars_os()
        .find_map(|(k, v)| {
            if k.to_string_lossy().eq_ignore_ascii_case("PATH") {
                Some(v)
            } else {
                None
            }
        })
        .unwrap_or_default();
    let paths = std::env::split_paths(&current_path);
    let mut new_paths: Vec<std::path::PathBuf> = Vec::new();
    for p in paths {
        let s = p.to_string_lossy();
        if s.contains("\\target\\") || s.contains("/target/") {
            continue;
        }
        if !p.exists() || !p.is_dir() {
            continue;
        }
        let already_present = new_paths.iter().any(|existing| {
            if cfg!(windows) {
                existing.to_string_lossy().eq_ignore_ascii_case(&s)
            } else {
                existing == &p
            }
        });
        if !already_present {
            new_paths.push(p);
        }
    }

    let program_path = std::path::Path::new(program);
    if program_path.is_absolute() {
        if let Some(parent) = program_path.parent() {
            let parent_buf = parent.to_path_buf();
            let already_present = new_paths.iter().any(|existing| {
                if cfg!(windows) {
                    existing
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&parent_buf.to_string_lossy())
                } else {
                    existing == &parent_buf
                }
            });
            if !already_present {
                new_paths.insert(0, parent_buf);
            }
        }
    }

    let common_dirs = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    for dir in &common_dirs {
        let path_buf = std::path::PathBuf::from(dir);
        if path_buf.exists() && !new_paths.contains(&path_buf) {
            new_paths.push(path_buf);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let npm_dirs = [
            format!("{}/.npm-global/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/n/bin", home),
        ];
        for dir in &npm_dirs {
            let path_buf = std::path::PathBuf::from(dir);
            if path_buf.exists() && !new_paths.contains(&path_buf) {
                new_paths.push(path_buf);
            }
        }

        let nvm_dir_val = std::env::var("NVM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(&home).join(".nvm"));
        let nvm_bin = nvm_dir_val.join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_bin) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            versions.sort_by(|a, b| {
                let a_name = a.file_name().to_string_lossy().to_string();
                let b_name = b.file_name().to_string_lossy().to_string();
                b_name.cmp(&a_name)
            });
            for version_dir in versions {
                let bin_path = version_dir.path().join("bin");
                if bin_path.exists() && !new_paths.contains(&bin_path) {
                    new_paths.push(bin_path);
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let win_dirs = [
            "C:\\Windows\\System32",
            "C:\\Windows",
            "C:\\Windows\\System32\\Wbem",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
            "C:\\Program Files\\nodejs",
        ];
        for dir in &win_dirs {
            let pb = std::path::PathBuf::from(dir);
            if pb.exists() && !new_paths.contains(&pb) {
                new_paths.push(pb);
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_roaming = std::path::PathBuf::from(appdata).join("npm");
            if npm_roaming.exists() && !new_paths.contains(&npm_roaming) {
                new_paths.push(npm_roaming);
            }
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let py_dir = std::path::PathBuf::from(&local_appdata)
                .join("Programs")
                .join("Python");
            if let Ok(entries) = std::fs::read_dir(&py_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.is_dir() {
                        let scripts = p.join("Scripts");
                        if scripts.exists() && !new_paths.contains(&scripts) {
                            new_paths.push(scripts);
                        }
                        if !new_paths.contains(&p) {
                            new_paths.push(p);
                        }
                    }
                }
            }
            let py_bin = std::path::PathBuf::from(&local_appdata)
                .join("Python")
                .join("bin");
            if py_bin.exists() && !new_paths.contains(&py_bin) {
                new_paths.push(py_bin);
            }
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let user_profile_path = std::path::PathBuf::from(&userprofile);
            let local_bin = user_profile_path.join(".local").join("bin");
            if local_bin.exists() && !new_paths.contains(&local_bin) {
                new_paths.push(local_bin);
            }
            let cargo_bin = user_profile_path.join(".cargo").join("bin");
            if cargo_bin.exists() && !new_paths.contains(&cargo_bin) {
                new_paths.push(cargo_bin);
            }
            let bun_bin = user_profile_path.join(".bun").join("bin");
            if bun_bin.exists() && !new_paths.contains(&bun_bin) {
                new_paths.push(bun_bin);
            }
        }
    }

    #[cfg(windows)]
    {
        cmd.env_remove("Path");
        cmd.env_remove("path");

        // Windows cmd.exe has an 8191 character limit for the environment block / variable.
        // Keep PATH safely under 4096 chars so child launchers (like npx) have plenty of room.
        let mut total_len = 0;
        let mut bounded_paths = Vec::new();
        for p in new_paths {
            let p_len = p.as_os_str().len() + 1;
            if total_len + p_len > 4096 {
                break;
            }
            total_len += p_len;
            bounded_paths.push(p);
        }
        if let Ok(joined) = std::env::join_paths(bounded_paths) {
            cmd.env("PATH", joined);
        }
    }

    #[cfg(not(windows))]
    if let Ok(joined) = std::env::join_paths(new_paths) {
        cmd.env("PATH", joined);
    }

    cmd
}

async fn resolve_executable_via_shell(program: &str) -> Option<String> {
    if std::path::Path::new(program).is_absolute() && std::path::Path::new(program).exists() {
        return Some(program.to_string());
    }
    if let Ok(path) = which::which(program) {
        return Some(path.to_string_lossy().into_owned());
    }
    let fb = find_executable(program).await;
    if fb != program && std::path::Path::new(&fb).exists() {
        return Some(fb);
    }
    None
}

/// Probes whether the given program is resolvable to an executable.
///
/// Returns an [`ExecutableInfo`] describing whether it was found, the resolved
/// path, and a best-effort `--version` string. Used by the settings UI to show
/// a green/red status *before* the user clicks Connect.
pub async fn check_executable(program: &str) -> ExecutableInfo {
    let program = program.trim();
    if program.is_empty() {
        return ExecutableInfo {
            found: false,
            path: None,
            version: None,
            message: "Enter a command to check".to_string(),
        };
    }

    let resolved_opt = resolve_executable_via_shell(program).await;
    let (found, resolved) = match resolved_opt {
        Some(path) => (true, path),
        None => {
            let fb = find_executable(program).await;
            let exists = std::path::Path::new(&fb).exists() || which::which(&fb).is_ok();
            if exists {
                (true, fb)
            } else {
                (false, program.to_string())
            }
        }
    };

    if !found {
        return ExecutableInfo {
            found: false,
            path: None,
            version: None,
            message: format!(
                "\"{}\" was not found on PATH or in common install locations. \
                 Check the spelling, install the runtime it belongs to, \
                 or enter the full path (e.g. /usr/local/bin/{}).",
                program, program
            ),
        };
    }

    let version = probe_version(&resolved).await;

    let message = match &version {
        Some(v) => format!(
            "{} found{} — {}",
            program,
            at_path_note(&resolved, program),
            v
        ),
        None => format!("{} found{}", program, at_path_note(&resolved, program)),
    };

    ExecutableInfo {
        found: true,
        path: Some(resolved),
        version,
        message,
    }
}

fn at_path_note(resolved: &str, program: &str) -> String {
    if resolved == program {
        String::new()
    } else {
        format!(" at {}", resolved)
    }
}

/// Runs `<program> --version` with a short timeout and returns the first line
/// of output trimmed. Returns `None` on any failure — it's only a hint.
async fn probe_version(resolved: &str) -> Option<String> {
    let mut cmd = create_shell_command(resolved, &["--version".to_string()]);
    let output = tokio::time::timeout(std::time::Duration::from_secs(4), cmd.output())
        .await
        .ok()?
        .ok()?;

    let text = if !output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };

    text.lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
}

/// Produces a user-friendly error string when spawning the MCP process fails.
/// Distinguishes "not found" (PATH/install issue) from permission errors so the
/// frontend can surface an actionable install hint.
fn friendly_spawn_error(program: &str, resolved: &str, err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!(
            "Could not start \"{}\": the executable was not found \
             (resolved to \"{}\"). Install the runtime it belongs to \
             (e.g. Node.js for npx, uv for uvx, Python for python) \
             or set the full path in the Command field.",
            program, resolved
        ),
        std::io::ErrorKind::PermissionDenied => format!(
            "Could not start \"{}\" at \"{}\": permission denied. \
             Check that the file is executable (chmod +x) or pick a different path.",
            program, resolved
        ),
        _ => format!("Could not start \"{}\" ({}): {}", program, resolved, err),
    }
}

pub async fn connect_server(
    config: &McpServerConfig,
    env_secrets: HashMap<String, String>,
) -> Result<Vec<McpToolInfo>, String> {
    let env_secrets = SensitiveEnvironment(env_secrets);
    if !config.enabled {
        return Err(format!("MCP server '{}' is disabled", config.id));
    }

    let connection_generation = {
        let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.begin_connection(&config.id)
    };
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let ct = cancel_token.clone();
    let server_id = config.id.clone();

    let client_info = ClientInfo::default();
    let client = SythoriaMcpClient { info: client_info };

    match config.transport.as_str() {
        "stdio" => {
            let command_raw = config.command.as_deref().unwrap_or("").to_string();
            let program = resolve_executable_name(&command_raw)?;

            let extra_args = config.args.as_deref().unwrap_or(&[]);
            let resolved_args: Vec<String> = extra_args.to_vec();

            let resolved_program = match resolve_executable_via_shell(&program).await {
                Some(path) => path,
                None => find_executable(&program).await,
            };

            let mut cmd = create_shell_command(&resolved_program, &resolved_args);
            cmd.stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());

            for (key, value) in &env_secrets.0 {
                if is_explicit_env_key_allowed(key) {
                    cmd.env(key, value);
                } else {
                    log::warn!("Filtered out disallowed environment variable: {}", key);
                }
            }

            let stderr_buffer = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
            let (transport, stderr_opt) = TokioChildProcess::builder(cmd)
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| {
                    // TokioChildProcess wraps the underlying io::Error in its own Display.
                    // Pull the raw kind by attempting a downcast-style inspection via string.
                    let raw_err = std::io::Error::other(e.to_string());
                    let kind = io_error_kind_from_display(&e.to_string());
                    let synthetic = match kind {
                        Some(k) => std::io::Error::new(k, e.to_string()),
                        None => raw_err,
                    };
                    friendly_spawn_error(&program, &resolved_program, &synthetic)
                })?;

            if let Some(stderr) = stderr_opt {
                let s_id = server_id.clone();
                let buf_clone = stderr_buffer.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut reader = tokio::io::BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        log::info!("[MCP {} stderr] {}", s_id, line);
                        let mut buf = buf_clone.lock().await;
                        if buf.len() > 30 {
                            buf.remove(0);
                        }
                        buf.push(line);
                    }
                });
            }

            let mut running = match client.serve_with_ct(transport, ct).await {
                Ok(r) => r,
                Err(e) => {
                    let err_str = e.to_string();
                    let captured = {
                        let buf = stderr_buffer.lock().await;
                        buf.join(" | ")
                    };
                    if !captured.trim().is_empty() {
                        return Err(format!(
                            "MCP handshake failed for '{}': {}",
                            resolved_program,
                            captured.trim()
                        ));
                    }
                    if err_str.contains("connection closed")
                        || err_str.contains("Connection closed")
                    {
                        return Err(format!(
                            "MCP handshake failed for '{}': the process exited unexpectedly before completing initialization. Verify that required credentials, arguments, and runtime dependencies are correctly configured.",
                            resolved_program
                        ));
                    }
                    return Err(format!(
                        "MCP handshake failed for '{}': {}",
                        resolved_program, err_str
                    ));
                }
            };

            let tools_result = running
                .peer()
                .list_tools(Default::default())
                .await
                .map_err(|e| format!("Failed to list MCP tools: {}", e))?;

            let tools = restrict_catalog_tools(
                tools_result.tools.iter().map(convert_tool).collect(),
                &env_secrets.0,
            )?;

            let (request_tx, mut request_rx) = tokio::sync::mpsc::channel::<McpServerRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();
            let server_id_clone = server_id.clone();
            let task_generation = connection_generation;

            tokio::spawn(async move {
                let mut timeout_sleep =
                    Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                loop {
                    tokio::select! {
                        req = request_rx.recv() => {
                            match req {
                                Some(req) => {
                                    match req {
                                        McpServerRequest::CallTool { tool_name, arguments, cancel_token, reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let result = match cancel_token {
                                                Some(cancel_token) => tokio::select! {
                                                    _ = cancel_token.cancelled() => Err("Tool call cancelled".to_string()),
                                                    result = call_tool_via_peer(&peer, &tool_name, &arguments) => result,
                                                },
                                                None => call_tool_via_peer(&peer, &tool_name, &arguments).await,
                                            };
                                            let _ = reply_tx.send(result);
                                        }
                                        McpServerRequest::ListResources { reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let res = peer.list_resources(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                        McpServerRequest::ListPrompts { reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let res = peer.list_prompts(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                    }
                                }
                                None => break,
                            }
                        }
                        _ = &mut timeout_sleep => {
                            log::info!("MCP server '{}' idle timeout: terminating child process", server_id_clone);
                            if let Ok(mut manager) = MCP_SERVERS.lock() {
                                manager.mark_idle(&server_id_clone, task_generation);
                            }
                            break;
                        }
                        _ = task_cancel.cancelled() => {
                            break;
                        }
                    }
                }
                let _ = running.close().await;
            });

            let handle = McpServerHandle {
                tools: tools.clone(),
                cancel_token,
                request_tx: Some(request_tx),
                config: config.clone(),
                env_secrets: env_secrets.0.clone(),
                connection_generation,
            };

            let connected = {
                let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
                manager.complete_connection(server_id, connection_generation, handle)
            };

            if !connected {
                return Err(format!(
                    "MCP server '{}' connection was superseded",
                    config.id
                ));
            }

            Ok(tools)
        }
        "sse" | "streamable-http" => {
            let base_url = config.baseUrl.as_deref().unwrap_or("").to_string();
            if base_url.is_empty() {
                return Err("Base URL is required for HTTP transport".to_string());
            }

            let has_secret = config.apiKey.as_deref().is_some_and(|key| !key.is_empty());
            let endpoint = crate::endpoint_security::validate_http_endpoint(
                &base_url,
                has_secret,
                std::time::Duration::from_secs(120),
            )
            .await
            .map_err(|error| error.to_string())?;
            let validated_url = endpoint.url.to_string();

            let mut transport_config =
                StreamableHttpClientTransportConfig::with_uri(Arc::from(validated_url.as_str()));

            if let Some(api_key) = &config.apiKey {
                if !api_key.is_empty() {
                    transport_config = transport_config.auth_header(api_key.as_str());
                }
            }

            let transport = rmcp::transport::StreamableHttpClientTransport::with_client(
                endpoint.client,
                transport_config,
            );

            let mut running = client
                .serve_with_ct(transport, ct)
                .await
                .map_err(|e| format!("MCP handshake failed: {}", e))?;

            let tools_result = running
                .peer()
                .list_tools(Default::default())
                .await
                .map_err(|e| format!("Failed to list MCP tools: {}", e))?;

            let tools = restrict_catalog_tools(
                tools_result.tools.iter().map(convert_tool).collect(),
                &env_secrets.0,
            )?;

            let (request_tx, mut request_rx) = tokio::sync::mpsc::channel::<McpServerRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        req = request_rx.recv() => {
                            match req {
                                Some(req) => {
                                    match req {
                                        McpServerRequest::CallTool { tool_name, arguments, cancel_token, reply_tx } => {
                                            let result = match cancel_token {
                                                Some(cancel_token) => tokio::select! {
                                                    _ = cancel_token.cancelled() => Err("Tool call cancelled".to_string()),
                                                    result = call_tool_via_peer(&peer, &tool_name, &arguments) => result,
                                                },
                                                None => call_tool_via_peer(&peer, &tool_name, &arguments).await,
                                            };
                                            let _ = reply_tx.send(result);
                                        }
                                        McpServerRequest::ListResources { reply_tx } => {
                                            let res = peer.list_resources(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                        McpServerRequest::ListPrompts { reply_tx } => {
                                            let res = peer.list_prompts(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                    }
                                }
                                None => break,
                            }
                        }
                        _ = task_cancel.cancelled() => {
                            break;
                        }
                    }
                }
                let _ = running.close().await;
            });

            let handle = McpServerHandle {
                tools: tools.clone(),
                cancel_token,
                request_tx: Some(request_tx),
                config: config.clone(),
                env_secrets: env_secrets.0.clone(),
                connection_generation,
            };

            let connected = {
                let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
                manager.complete_connection(server_id, connection_generation, handle)
            };

            if !connected {
                return Err(format!(
                    "MCP server '{}' connection was superseded",
                    config.id
                ));
            }

            Ok(tools)
        }
        _ => Err(format!("Unknown transport: {}", config.transport)),
    }
}

async fn call_tool_via_peer(
    peer: &rmcp::service::Peer<rmcp::service::RoleClient>,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, String> {
    let args_map: serde_json::Map<String, serde_json::Value> =
        arguments.as_object().cloned().unwrap_or_default();

    let params =
        rmcp::model::CallToolRequestParams::new(tool_name.to_string()).with_arguments(args_map);

    match peer.call_tool(params).await {
        Ok(result) => {
            let mut text_parts: Vec<String> = Vec::new();
            let mut images: Vec<crate::mcp::McpImageContent> = Vec::new();

            for c in result.content {
                match c {
                    rmcp::model::ContentBlock::Text(text_content) => {
                        text_parts.push(text_content.text.to_string());
                    }
                    rmcp::model::ContentBlock::Image(img_content) => {
                        images.push(crate::mcp::McpImageContent {
                            mime_type: img_content.mime_type.clone(),
                            data: img_content.data.clone(),
                        });
                    }
                    rmcp::model::ContentBlock::Audio(audio_content) => {
                        text_parts.push(format!("[Audio: {}]", audio_content.mime_type));
                    }
                    rmcp::model::ContentBlock::Resource(resource_content) => {
                        text_parts.push(format!("[Resource: {:?}]", resource_content.resource));
                    }
                    _ => {
                        text_parts.push("[Unknown content]".to_string());
                    }
                }
            }

            Ok(McpToolResult {
                content: text_parts.join("\n"),
                is_error: result.is_error.unwrap_or(false),
                images,
            })
        }
        Err(e) => Ok(McpToolResult {
            content: format!("MCP tool call error: {}", e),
            is_error: true,
            images: vec![],
        }),
    }
}

pub async fn call_tool_on_server(
    server_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
    cancel_token: Option<tokio_util::sync::CancellationToken>,
) -> Result<McpToolResult, String> {
    let respawn = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.respawn_config(server_id)?
    };

    if let Some((config, env_secrets)) = respawn {
        log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
        connect_server(&config, env_secrets).await?;
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.tool_authorization(server_id, tool_name)?;
        manager.executable_request_tx(server_id)?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::CallTool {
            tool_name: tool_name.to_string(),
            arguments: arguments.clone(),
            cancel_token,
            reply_tx,
        })
        .await
        .map_err(|e| format!("Failed to send tool request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Tool call cancelled: {}", e))?
}

pub fn disconnect_server(server_id: &str) -> Result<(), String> {
    let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    manager.disconnect_server(server_id);
    Ok(())
}

/// Best-effort classification of a `TokioChildProcess` error string into an
/// `io::ErrorKind`, so [`friendly_spawn_error`] can pick the right message.
/// Tokio surfaces the OS error verbatim in the Display, so we sniff keywords.
fn io_error_kind_from_display(msg: &str) -> Option<std::io::ErrorKind> {
    let lower = msg.to_ascii_lowercase();
    if lower.contains("no such file or directory")
        || lower.contains("not found")
        || lower.contains("cannot find")
        || lower.contains("program not found")
    {
        Some(std::io::ErrorKind::NotFound)
    } else if lower.contains("permission denied") || lower.contains("not executable") {
        Some(std::io::ErrorKind::PermissionDenied)
    } else {
        None
    }
}

pub async fn list_resources_on_server(server_id: &str) -> Result<serde_json::Value, String> {
    let respawn = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.respawn_config(server_id)?
    };

    if let Some((config, env_secrets)) = respawn {
        log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
        connect_server(&config, env_secrets).await?;
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.executable_request_tx(server_id)?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::ListResources { reply_tx })
        .await
        .map_err(|e| format!("Failed to send list resources request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Request cancelled: {}", e))?
}

pub async fn list_prompts_on_server(server_id: &str) -> Result<serde_json::Value, String> {
    let respawn = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.respawn_config(server_id)?
    };

    if let Some((config, env_secrets)) = respawn {
        log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
        connect_server(&config, env_secrets).await?;
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.executable_request_tx(server_id)?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::ListPrompts { reply_tx })
        .await
        .map_err(|e| format!("Failed to send list prompts request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Request cancelled: {}", e))?
}

#[cfg(test)]
mod tests {
    #[test]
    fn catalog_permissions_hide_unapproved_tools_and_reject_invalid_policy() {
        let tool = |name: &str| McpToolInfo {
            name: name.into(),
            description: "".into(),
            inputSchema: serde_json::json!({}),
            readOnlyHint: None,
        };
        let env = HashMap::from([("SYTHORIA_ALLOWED_TOOLS".into(), "[\"read_email\"]".into())]);
        let tools = restrict_catalog_tools(
            vec![
                tool("read_email"),
                tool("send_email"),
                tool("manage_accounts"),
            ],
            &env,
        )
        .unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "read_email");
        assert!(restrict_catalog_tools(
            vec![tool("read_email")],
            &HashMap::from([("SYTHORIA_ALLOWED_TOOLS".into(), "invalid".into())])
        )
        .is_err());
    }

    use super::*;

    #[test]
    fn resolve_executable_name_trims_whitespace() {
        assert_eq!(resolve_executable_name("  npx  ").unwrap(), "npx");
        assert_eq!(resolve_executable_name("npx").unwrap(), "npx");
        assert_eq!(
            resolve_executable_name("/usr/local/bin/node").unwrap(),
            "/usr/local/bin/node"
        );
    }

    #[test]
    fn resolve_executable_name_rejects_empty() {
        assert!(resolve_executable_name("").is_err());
        assert!(resolve_executable_name("   ").is_err());
        assert!(resolve_executable_name("\t\n").is_err());
    }

    #[test]
    fn resolve_executable_name_keeps_full_command_unchanged() {
        // Legacy behaviour split a full command line; the new contract is
        // program-only, so a value that happens to contain spaces is kept as-is
        // (the frontend migration guarantees single-token input).
        assert_eq!(
            resolve_executable_name("some/path with space").unwrap(),
            "some/path with space"
        );
    }

    #[test]
    fn io_error_kind_classifies_messages() {
        assert_eq!(
            io_error_kind_from_display("No such file or directory (os error 2)"),
            Some(std::io::ErrorKind::NotFound)
        );
        assert_eq!(
            io_error_kind_from_display("Permission denied (os error 13)"),
            Some(std::io::ErrorKind::PermissionDenied)
        );
        assert_eq!(io_error_kind_from_display("something else"), None);
    }

    #[test]
    fn friendly_spawn_error_not_found_mentions_install() {
        let msg = friendly_spawn_error(
            "npx",
            "/usr/bin/npx",
            &std::io::Error::new(std::io::ErrorKind::NotFound, "missing"),
        );
        assert!(msg.contains("not found"));
        assert!(msg.contains("Install"));
    }

    #[test]
    fn test_create_shell_command() {
        let cmd = create_shell_command("echo", &["hello".to_string(), "world".to_string()]);

        assert_eq!(cmd.as_std().get_program().to_string_lossy(), "echo");
        let args: Vec<_> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["hello", "world"]);

        let configured_env: HashMap<_, _> = cmd
            .as_std()
            .get_envs()
            .filter_map(|(key, value)| value.map(|value| (key.to_owned(), value.to_owned())))
            .collect();
        assert!(configured_env.contains_key(std::ffi::OsStr::new("PATH")));
        assert!(!configured_env.contains_key(std::ffi::OsStr::new("AWS_SECRET_ACCESS_KEY")));
        assert!(!configured_env.contains_key(std::ffi::OsStr::new("SSH_AUTH_SOCK")));
    }

    #[test]
    fn test_create_shell_command_npx_windows() {
        if cfg!(windows) {
            let cmd =
                create_shell_command("npx", &["-y".to_string(), "linear-mcp-server".to_string()]);
            let prog = cmd.as_std().get_program().to_string_lossy().to_string();
            assert!(
                prog.ends_with("node.exe")
                    || prog.ends_with("cmd.exe")
                    || prog.ends_with("npx.cmd"),
                "Expected node.exe or cmd.exe or npx.cmd on Windows, got: {}",
                prog
            );
        }
    }

    #[test]
    fn explicit_server_environment_keys_are_portable_identifiers() {
        assert!(is_explicit_env_key_allowed("GITHUB_PERSONAL_ACCESS_TOKEN"));
        assert!(is_explicit_env_key_allowed("custom_value"));
        assert!(!is_explicit_env_key_allowed(""));
        assert!(!is_explicit_env_key_allowed("9INVALID"));
        assert!(!is_explicit_env_key_allowed("INVALID=VALUE"));
        assert!(!is_explicit_env_key_allowed("INVALID-VALUE"));
    }

    #[tokio::test]
    async fn sanitized_environment_supports_node_package_launchers_when_installed() {
        if let Some(node) = resolve_executable_via_shell("node").await {
            let ambient_key = std::env::vars_os().find_map(|(key, value)| {
                let normalized = key.to_string_lossy().to_ascii_uppercase();
                (!value.is_empty()
                    && normalized != "PATH"
                    && !MCP_RUNTIME_ENV_ALLOWLIST.contains(&normalized.as_str()))
                .then_some(key)
            });
            if let Some(ambient_key) = ambient_key {
                let output = create_shell_command(
                    &node,
                    &[
                        "-e".to_string(),
                        "process.stdout.write(Object.prototype.hasOwnProperty.call(process.env, process.argv[1]) ? 'present' : 'absent')"
                            .to_string(),
                        ambient_key.to_string_lossy().into_owned(),
                    ],
                )
                .output()
                .await
                .expect("launch Node environment probe");
                assert_eq!(String::from_utf8_lossy(&output.stdout), "absent");
            }
        }

        for launcher in ["node", "npm", "npx"] {
            let Some(resolved) = resolve_executable_via_shell(launcher).await else {
                continue;
            };
            let output = create_shell_command(&resolved, &["--version".to_string()])
                .output()
                .await
                .unwrap_or_else(|error| panic!("failed to launch {launcher}: {error}"));
            assert!(
                output.status.success(),
                "{launcher} failed with sanitized environment: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[tokio::test]
    async fn test_resolve_executable_via_shell() {
        let git_path = resolve_executable_via_shell("git").await;
        assert!(git_path.is_some());
        let path = git_path.unwrap();
        assert!(path.contains("git") || std::path::Path::new(&path).exists());

        let fake = resolve_executable_via_shell("non_existent_command_12345").await;
        assert!(fake.is_none());
    }

    #[tokio::test]
    async fn test_connect_server_stdio_node() {
        let Some(node) = resolve_executable_via_shell("node").await else {
            return;
        };

        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join(format!("mcp_test_{}.js", uuid::Uuid::new_v4()));
        let script_content = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

console.error("Test server starting on stdio...");
rl.on('line', (line) => {
    try {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
            const res = {
                jsonrpc: "2.0",
                id: req.id,
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "test-server", version: "1.0.0" }
                }
            };
            process.stdout.write(JSON.stringify(res) + "\n");
        } else if (req.method === 'notifications/initialized') {
            // Handshake complete
        } else if (req.method === 'tools/list') {
            const res = {
                jsonrpc: "2.0",
                id: req.id,
                result: {
                    tools: [
                        {
                            name: "hello_tool",
                            description: "Says hello",
                            inputSchema: { type: "object" }
                        }
                    ]
                }
            };
            process.stdout.write(JSON.stringify(res) + "\n");
        }
    } catch (e) {
        console.error("Error processing line:", e);
    }
});
"#;
        std::fs::write(&script_path, script_content).unwrap();

        let server_id = format!("test-srv-{}", uuid::Uuid::new_v4());
        let config = McpServerConfig {
            id: server_id.clone(),
            name: "Test Node MCP".to_string(),
            transport: "stdio".to_string(),
            command: Some(node),
            args: Some(vec![script_path.to_string_lossy().to_string()]),
            baseUrl: None,
            apiKey: None,
            enabled: true,
            trustLevel: Some("untrusted".to_string()),
        };

        {
            let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
            manager.set_explicitly_enabled(&server_id, true);
        }

        let result = connect_server(&config, HashMap::new()).await;
        let _ = std::fs::remove_file(&script_path);

        assert!(
            result.is_ok(),
            "Expected connect_server to succeed, got error: {:?}",
            result.err()
        );
        let tools = result.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "hello_tool");
    }

    #[tokio::test]
    async fn test_connect_server_captures_stderr_on_exit() {
        let Some(node) = resolve_executable_via_shell("node").await else {
            return;
        };

        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join(format!("mcp_fail_test_{}.js", uuid::Uuid::new_v4()));
        let script_content = r#"
console.error("Fatal: API key invalid or missing!");
process.exit(1);
"#;
        std::fs::write(&script_path, script_content).unwrap();

        let server_id = format!("test-srv-fail-{}", uuid::Uuid::new_v4());
        let config = McpServerConfig {
            id: server_id.clone(),
            name: "Failing MCP".to_string(),
            transport: "stdio".to_string(),
            command: Some(node),
            args: Some(vec![script_path.to_string_lossy().to_string()]),
            baseUrl: None,
            apiKey: None,
            enabled: true,
            trustLevel: Some("untrusted".to_string()),
        };

        {
            let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
            manager.set_explicitly_enabled(&server_id, true);
        }

        let result = connect_server(&config, HashMap::new()).await;
        let _ = std::fs::remove_file(&script_path);

        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("Fatal: API key invalid or missing!"),
            "Error should contain captured stderr, got: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_connect_server_with_npx() {
        let server_id = format!("test-srv-npx-{}", uuid::Uuid::new_v4());
        let config = McpServerConfig {
            id: server_id.clone(),
            name: "GitHub Plugin Test".to_string(),
            transport: "stdio".to_string(),
            command: Some("npx".to_string()),
            args: Some(vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-github".to_string(),
            ]),
            baseUrl: None,
            apiKey: None,
            enabled: true,
            trustLevel: Some("untrusted".to_string()),
        };

        {
            let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
            manager.set_explicitly_enabled(&server_id, true);
        }

        let mut env_secrets = HashMap::new();
        env_secrets.insert(
            "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
            "dummy_token".to_string(),
        );
        let result = connect_server(&config, env_secrets).await;
        if let Err(err) = &result {
            assert!(
                !err.contains("is not recognized as an internal or external command"),
                "MCP launcher failed to find command shim: {}",
                err
            );
        } else {
            let tools = result.unwrap();
            assert!(!tools.is_empty(), "Expected GitHub server to return tools");
        }
    }
}
