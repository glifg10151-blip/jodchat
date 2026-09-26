use crate::project::{resolve_project_root, ProjectRegistry};
use crate::AppError;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    session_id: String,
    shell: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
    exit_code: u32,
    signal: Option<String>,
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.trim().is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/sh".to_string()
                }
            })
    }
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: tauri::State<'_, TerminalRegistry>,
    projects: tauri::State<'_, ProjectRegistry>,
    session_id: String,
    project_id: String,
    worktree_path: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalStartResult, AppError> {
    if session_id.trim().is_empty() {
        return Err(AppError::AppPath(
            "Terminal session ID is required".to_string(),
        ));
    }
    if state
        .sessions
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .contains_key(&session_id)
    {
        return Err(AppError::AppPath(
            "Terminal session already exists".to_string(),
        ));
    }

    let project = projects
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?;
    let cwd = resolve_project_root(&projects, &project, &project_id, worktree_path.as_deref())?;
    let shell = default_shell();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(terminal_size(cols, rows))
        .map_err(|error| AppError::AppPath(format!("Failed to open terminal: {error}")))?;

    let mut command = CommandBuilder::new(&shell);
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::AppPath(format!("Failed to launch default shell: {error}")))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| AppError::AppPath(format!("Failed to read terminal output: {error}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| AppError::AppPath(format!("Failed to open terminal input: {error}")))?;
    let killer = child.clone_killer();

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
        sessions.insert(
            session_id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                killer,
            },
        );
    }

    let output_app = app.clone();
    let output_session_id = session_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: output_session_id.clone(),
                            data: buffer[..count].to_vec(),
                        },
                    );
                }
            }
        }
    });

    let exit_app = app.clone();
    let exit_session_id = session_id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        if let Some(registry) = exit_app.try_state::<TerminalRegistry>() {
            if let Ok(mut sessions) = registry.sessions.lock() {
                sessions.remove(&exit_session_id);
            }
        }
        if let Ok(status) = status {
            let _ = exit_app.emit(
                "terminal-exit",
                TerminalExit {
                    session_id: exit_session_id,
                    exit_code: status.exit_code(),
                    signal: status.signal().map(str::to_string),
                },
            );
        }
    });

    Ok(TerminalStartResult { session_id, shell })
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| AppError::AppPath("Terminal session is not running".to_string()))?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| AppError::AppPath(format!("Failed to write to terminal: {error}")))
}

#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| AppError::AppPath("Terminal session is not running".to_string()))?;
    session
        .master
        .resize(terminal_size(cols, rows))
        .map_err(|error| AppError::AppPath(format!("Failed to resize terminal: {error}")))
}

#[tauri::command]
pub fn terminal_stop(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .remove(&session_id);
    if let Some(mut session) = session {
        session
            .killer
            .kill()
            .map_err(|error| AppError::AppPath(format!("Failed to stop terminal: {error}")))?;
    }
    Ok(())
}
