use crate::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const WORKTREE_BASELINE_REF_PREFIX: &str = "refs/sythoria/baselines";
const WORKSPACE_UNDO_DIR: &str = "workspace-undo";

struct AppliedWorktreeChanges {
    changed_paths: Vec<String>,
    patch: Vec<u8>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeApplyResult {
    pub changed_paths: Vec<String>,
    pub undo_token: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotResult {
    pub changed_paths: Vec<String>,
    pub diff: String,
    pub undo_token: Option<String>,
}

struct TemporaryGitIndex {
    path: PathBuf,
}

impl TemporaryGitIndex {
    fn new(root: &Path, id: &str) -> Self {
        Self {
            path: root.join(format!(".snapshot-index-{id}")),
        }
    }
}

impl Drop for TemporaryGitIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let mut lock_path = self.path.as_os_str().to_os_string();
        lock_path.push(".lock");
        let _ = std::fs::remove_file(PathBuf::from(lock_path));
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub path: String,
    pub branch: String,
    pub is_dirty: bool,
    pub staged_files: Vec<String>,
    pub unstaged_files: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
}

fn get_and_validate_git_project(
    state: &crate::project::ProjectRegistry,
    project_id: &str,
    write_required: bool,
    worktree_path: Option<&str>,
    allow_worktree_override: bool,
    run_token: Option<&str>,
) -> Result<PathBuf, AppError> {
    let capability_root = if let Some(token) = run_token {
        crate::project::validate_project_run_access(
            state,
            token,
            project_id,
            worktree_path,
            write_required,
        )
        .map_err(|e| AppError::GitError(e.to_string()))?
    } else if let Some(path) = worktree_path.filter(|_| !write_required && allow_worktree_override)
    {
        let project = state
            .projects
            .lock()
            .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
            .get(project_id)
            .cloned()
            .ok_or_else(|| {
                AppError::GitError("Access denied: Project not found in registry".to_string())
            })?;
        Some(
            crate::project::validate_owned_worktree(&project, path, None)
                .map_err(|e| AppError::GitError(e.to_string()))?
                .path,
        )
    } else {
        let active_guard = state
            .active_project_id
            .lock()
            .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?;
        match &*active_guard {
            Some(active_id) if active_id == project_id => {}
            _ => {
                return Err(AppError::GitError(
                    "Access denied: Project is not the active project".to_string(),
                ))
            }
        }
        None
    };

    // 2. Retrieve project config
    let projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?;
    let project = projects_guard
        .get(project_id)
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?
        .clone();
    drop(projects_guard);

    // 3. Check permission
    if write_required && project.permissions == crate::project::ProjectPermission::Read {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }

    let repo_path = if let Some(path) = capability_root {
        path
    } else if allow_worktree_override {
        crate::project::resolve_project_root(state, &project, project_id, worktree_path)
            .map_err(|e| AppError::GitError(e.to_string()))?
    } else {
        Path::new(&project.path)
            .canonicalize()
            .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?
    };

    Ok(repo_path)
}

fn resolve_git_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, AppError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::GitError(
            "Git returned an unsafe workspace-relative path".to_string(),
        ));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize workspace root: {e}")))?;
    let candidate = canonical_root.join(relative);
    let mut existing = candidate.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            AppError::GitError("Git path has no existing workspace ancestor".to_string())
        })?;
    }
    let canonical_ancestor = existing
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to validate Git path: {e}")))?;
    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err(AppError::GitError(
            "Access denied: Git path escapes the workspace".to_string(),
        ));
    }

    Ok(candidate)
}

fn parse_changed_paths(output: &[u8]) -> Result<Vec<String>, AppError> {
    let mut fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let mut paths = Vec::new();

    while let Some(status) = fields.next() {
        if status.len() != 1 || !matches!(status[0], b'A' | b'M' | b'D' | b'T') {
            return Err(AppError::GitError(format!(
                "Git reported an unsupported worktree change status: {}",
                String::from_utf8_lossy(status)
            )));
        }

        let path = fields.next().ok_or_else(|| {
            AppError::GitError("Git returned a malformed changed-path list".to_string())
        })?;
        let path = String::from_utf8(path.to_vec()).map_err(|_| {
            AppError::GitError("Git returned a non-UTF-8 workspace path".to_string())
        })?;
        paths.push(path);
    }

    Ok(paths)
}

fn worktree_baseline_ref(branch_name: &str) -> String {
    format!("{WORKTREE_BASELINE_REF_PREFIX}/{branch_name}")
}

async fn resolve_optional_revision(
    repo_path: &Path,
    revision: &str,
    label: &str,
) -> Result<Option<String>, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--quiet", revision])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve {label}: {e}")))?;

    if output.status.success() {
        let object_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if object_id.is_empty() {
            return Err(AppError::GitError(format!(
                "Failed to resolve {label}: Git returned an empty revision"
            )));
        }
        return Ok(Some(object_id));
    }

    if output.status.code() == Some(1) && output.stderr.is_empty() {
        return Ok(None);
    }

    Err(AppError::GitError(format!(
        "Failed to resolve {label}: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

async fn resolve_optional_head(repo_path: &Path, label: &str) -> Result<Option<String>, AppError> {
    resolve_optional_revision(repo_path, "HEAD^{commit}", &format!("{label} HEAD")).await
}

async fn resolve_optional_worktree_baseline(
    worktree_dir: &Path,
) -> Result<Option<String>, AppError> {
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve worktree branch: {e}")))?;

    if !branch_output.status.success() {
        if branch_output.status.code() == Some(1) && branch_output.stderr.is_empty() {
            return Ok(None);
        }
        return Err(AppError::GitError(format!(
            "Failed to resolve worktree branch: {}",
            String::from_utf8_lossy(&branch_output.stderr).trim()
        )));
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    if branch.is_empty() {
        return Err(AppError::GitError(
            "Failed to resolve worktree branch: Git returned an empty branch".to_string(),
        ));
    }
    let baseline_revision = format!("{}^{{commit}}", worktree_baseline_ref(&branch));
    resolve_optional_revision(worktree_dir, &baseline_revision, "worktree baseline").await
}

async fn create_workspace_snapshot_commit(
    repo_path: &Path,
    worktree_root: &Path,
    snapshot_id: &str,
) -> Result<String, AppError> {
    let temporary_index = TemporaryGitIndex::new(worktree_root, snapshot_id);
    let primary_head = resolve_optional_head(repo_path, "primary").await?;

    let mut read_tree = Command::new("git");
    read_tree
        .arg("-C")
        .arg(repo_path)
        .env("GIT_INDEX_FILE", &temporary_index.path)
        .arg("read-tree");
    if let Some(head) = primary_head.as_deref() {
        read_tree.arg(head);
    } else {
        read_tree.arg("--empty");
    }
    let read_tree_output = read_tree
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to initialize workspace snapshot: {e}")))?;
    if !read_tree_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to initialize workspace snapshot: {}",
            String::from_utf8_lossy(&read_tree_output.stderr).trim()
        )));
    }

    let add_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .env("GIT_INDEX_FILE", &temporary_index.path)
        .args(["add", "-A", "--", "."])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to capture current project files: {e}")))?;
    if !add_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to capture current project files: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        )));
    }

    let tree_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .env("GIT_INDEX_FILE", &temporary_index.path)
        .arg("write-tree")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to write workspace snapshot tree: {e}")))?;
    if !tree_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to write workspace snapshot tree: {}",
            String::from_utf8_lossy(&tree_output.stderr).trim()
        )));
    }
    let tree = String::from_utf8_lossy(&tree_output.stdout)
        .trim()
        .to_string();
    if tree.is_empty() {
        return Err(AppError::GitError(
            "Failed to write workspace snapshot tree: Git returned an empty object ID".to_string(),
        ));
    }

    let mut commit_tree = Command::new("git");
    commit_tree
        .arg("-C")
        .arg(repo_path)
        .env("GIT_AUTHOR_NAME", "Sythoria")
        .env("GIT_AUTHOR_EMAIL", "workspace-snapshot@sythoria.invalid")
        .env("GIT_COMMITTER_NAME", "Sythoria")
        .env("GIT_COMMITTER_EMAIL", "workspace-snapshot@sythoria.invalid")
        .args(["commit-tree", &tree, "-m", "Sythoria workspace snapshot"]);
    if let Some(head) = primary_head.as_deref() {
        commit_tree.args(["-p", head]);
    }
    let commit_output = commit_tree
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to commit workspace snapshot: {e}")))?;
    if !commit_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to commit workspace snapshot: {}",
            String::from_utf8_lossy(&commit_output.stderr).trim()
        )));
    }
    let commit = String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string();
    if commit.is_empty() {
        return Err(AppError::GitError(
            "Failed to commit workspace snapshot: Git returned an empty object ID".to_string(),
        ));
    }

    Ok(commit)
}

async fn diff_workspace_snapshots(
    repo_path: &Path,
    baseline: &str,
    current: &str,
) -> Result<AppliedWorktreeChanges, AppError> {
    let names_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args([
            "diff",
            "--relative",
            "--name-status",
            "-z",
            "--no-renames",
            baseline,
            current,
            "--",
        ])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to list direct workspace changes: {e}")))?;
    if !names_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to list direct workspace changes: {}",
            String::from_utf8_lossy(&names_output.stderr).trim()
        )));
    }

    let changed_paths = parse_changed_paths(&names_output.stdout)?;
    for path in &changed_paths {
        resolve_git_relative_path(repo_path, path)?;
    }
    if changed_paths.is_empty() {
        return Ok(AppliedWorktreeChanges {
            changed_paths,
            patch: Vec::new(),
        });
    }

    let patch_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args([
            "diff",
            "--relative",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-renames",
            baseline,
            current,
            "--",
        ])
        .output()
        .await
        .map_err(|e| {
            AppError::GitError(format!("Failed to capture direct workspace changes: {e}"))
        })?;
    if !patch_output.status.success() || patch_output.stdout.is_empty() {
        return Err(AppError::GitError(format!(
            "Failed to capture direct workspace changes: {}",
            String::from_utf8_lossy(&patch_output.stderr).trim()
        )));
    }

    Ok(AppliedWorktreeChanges {
        changed_paths,
        patch: patch_output.stdout,
    })
}

async fn resolve_merge_base(
    worktree_dir: &Path,
    worktree_head: &str,
    primary_head: &str,
) -> Result<String, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .args(["merge-base", worktree_head, primary_head])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve worktree merge base: {e}")))?;
    if !output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to resolve worktree merge base: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let merge_base = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if merge_base.is_empty() {
        return Err(AppError::GitError(
            "Failed to resolve worktree merge base: Git returned an empty revision".to_string(),
        ));
    }
    Ok(merge_base)
}

async fn resolve_empty_tree(repo_path: &Path) -> Result<String, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["hash-object", "-t", "tree", "--stdin"])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to resolve Git's empty tree: {e}")))?;
    if !output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to resolve Git's empty tree: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let empty_tree = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if empty_tree.is_empty() {
        return Err(AppError::GitError(
            "Failed to resolve Git's empty tree: Git returned an empty object ID".to_string(),
        ));
    }
    Ok(empty_tree)
}

/// Reports changes in the isolated workspace relative to the commit it was
/// created from. This includes untracked and uncommitted files as well as clean
/// commits on the temporary branch.
async fn worktree_has_changes(repo_path: &Path, worktree_dir: &Path) -> Result<bool, AppError> {
    let status = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .args(["status", "--porcelain=v1", "--untracked-files=normal"])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to inspect worktree changes: {e}")))?;
    if !status.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to inspect worktree changes: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        )));
    }
    if !status.stdout.is_empty() {
        return Ok(true);
    }

    let worktree_head = resolve_optional_head(worktree_dir, "worktree").await?;
    if let (Some(worktree_head), Some(baseline)) = (
        worktree_head.as_deref(),
        resolve_optional_worktree_baseline(worktree_dir).await?,
    ) {
        let output = Command::new("git")
            .arg("-C")
            .arg(worktree_dir)
            .args(["diff", "--quiet", &baseline, worktree_head, "--"])
            .output()
            .await
            .map_err(|e| {
                AppError::GitError(format!("Failed to compare worktree to its baseline: {e}"))
            })?;
        return match output.status.code() {
            Some(0) => Ok(false),
            Some(1) => Ok(true),
            _ => Err(AppError::GitError(format!(
                "Failed to compare worktree to its baseline: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))),
        };
    }

    let primary_head = resolve_optional_head(repo_path, "primary").await?;
    match (worktree_head, primary_head) {
        (None, None) => Ok(false),
        (None, Some(_)) => Ok(true),
        (Some(worktree_head), None) => {
            let output = Command::new("git")
                .arg("-C")
                .arg(worktree_dir)
                .args(["ls-tree", "-r", "--name-only", &worktree_head, "--"])
                .output()
                .await
                .map_err(|e| {
                    AppError::GitError(format!("Failed to inspect the worktree commit: {e}"))
                })?;
            if !output.status.success() {
                return Err(AppError::GitError(format!(
                    "Failed to inspect the worktree commit: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                )));
            }
            Ok(!output.stdout.is_empty())
        }
        (Some(worktree_head), Some(primary_head)) => {
            let merge_base =
                resolve_merge_base(worktree_dir, &worktree_head, &primary_head).await?;
            let output = Command::new("git")
                .arg("-C")
                .arg(worktree_dir)
                .args(["diff", "--quiet", &merge_base, &worktree_head, "--"])
                .output()
                .await
                .map_err(|e| {
                    AppError::GitError(format!("Failed to compare worktree commits: {e}"))
                })?;
            match output.status.code() {
                Some(0) => Ok(false),
                Some(1) => Ok(true),
                _ => Err(AppError::GitError(format!(
                    "Failed to compare worktree commits: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ))),
            }
        }
    }
}

async fn run_git_apply(
    repo_path: &Path,
    patch: &[u8],
    extra_args: &[&str],
    operation: &str,
) -> Result<(), AppError> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_path).arg("apply");
    for argument in extra_args {
        command.arg(argument);
    }
    command
        .arg("--binary")
        .arg("--whitespace=nowarn")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| AppError::GitError(format!("Failed to start Git {operation}: {e}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::GitError(format!("Failed to open Git {operation} input")))?;
    stdin
        .write_all(patch)
        .await
        .map_err(|e| AppError::GitError(format!("Failed to write Git {operation} input: {e}")))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to finish Git {operation}: {e}")))?;
    if !output.status.success() {
        return Err(AppError::GitError(format!(
            "Git {operation} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    Ok(())
}

/// Apply every tracked and non-ignored untracked worktree change to the primary
/// working tree. Git validates and applies one binary patch atomically; a reverse
/// dry-run then verifies that the complete patch is present before callers may
/// remove the source worktree.
async fn apply_worktree_changes(
    repo_path: &Path,
    worktree_dir: &Path,
) -> Result<AppliedWorktreeChanges, AppError> {
    let add_output = Command::new("git")
        .arg("-C")
        .arg(worktree_dir)
        .arg("add")
        .arg("-A")
        .arg("--")
        .arg(".")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to stage worktree changes: {e}")))?;
    if !add_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to stage worktree changes: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        )));
    }

    let worktree_head = resolve_optional_head(worktree_dir, "worktree").await?;
    let primary_head = resolve_optional_head(repo_path, "primary").await?;
    let comparison_base = match resolve_optional_worktree_baseline(worktree_dir).await? {
        Some(baseline) => Some(baseline),
        None => match (worktree_head, primary_head) {
            (Some(worktree_head), Some(primary_head)) => {
                Some(resolve_merge_base(worktree_dir, &worktree_head, &primary_head).await?)
            }
            (Some(_), None) => Some(resolve_empty_tree(worktree_dir).await?),
            (None, None) => None,
            (None, Some(_)) => {
                return Err(AppError::GitError(
                    "Cannot apply an unborn worktree to a repository that already has commits"
                        .to_string(),
                ))
            }
        },
    };

    // Disabling rename detection gives one explicit path per create/delete, so
    // every path embedded in the patch can be validated against both roots.
    // Comparing the staged worktree state to its creation baseline includes
    // committed and uncommitted agent changes without reapplying the user's
    // pre-existing working-copy state. Legacy worktrees fall back to merge base.
    let mut names_command = Command::new("git");
    names_command
        .arg("-C")
        .arg(worktree_dir)
        .arg("diff")
        .arg("--cached")
        .arg("--name-status")
        .arg("-z")
        .arg("--no-renames");
    if let Some(base) = comparison_base.as_deref() {
        names_command.arg(base);
    }
    let names_output = names_command
        .arg("--")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to list worktree changes: {e}")))?;
    if !names_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to list worktree changes: {}",
            String::from_utf8_lossy(&names_output.stderr).trim()
        )));
    }

    let changed_paths = parse_changed_paths(&names_output.stdout)?;
    for path in &changed_paths {
        resolve_git_relative_path(worktree_dir, path)?;
        resolve_git_relative_path(repo_path, path)?;
    }

    if changed_paths.is_empty() {
        return Ok(AppliedWorktreeChanges {
            changed_paths,
            patch: Vec::new(),
        });
    }

    let mut patch_command = Command::new("git");
    patch_command
        .arg("-C")
        .arg(worktree_dir)
        .arg("diff")
        .arg("--cached")
        .arg("--binary")
        .arg("--full-index")
        .arg("--no-ext-diff")
        .arg("--no-renames");
    if let Some(base) = comparison_base.as_deref() {
        patch_command.arg(base);
    }
    let patch_output = patch_command
        .arg("--")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to build worktree patch: {e}")))?;
    if !patch_output.status.success() || patch_output.stdout.is_empty() {
        return Err(AppError::GitError(format!(
            "Failed to build a complete worktree patch: {}",
            String::from_utf8_lossy(&patch_output.stderr).trim()
        )));
    }

    run_git_apply(repo_path, &patch_output.stdout, &["--check"], "apply check").await?;
    run_git_apply(repo_path, &patch_output.stdout, &[], "apply").await?;
    run_git_apply(
        repo_path,
        &patch_output.stdout,
        &["--reverse", "--check"],
        "apply verification",
    )
    .await?;

    Ok(AppliedWorktreeChanges {
        changed_paths,
        patch: patch_output.stdout,
    })
}

fn workspace_undo_patch_path(app: &AppHandle, token: &str) -> Result<PathBuf, AppError> {
    let parsed = uuid::Uuid::parse_str(token)
        .map_err(|_| AppError::GitError("Invalid workspace undo token".to_string()))?;
    let undo_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::GitError(format!("Failed to resolve app data directory: {e}")))?
        .join(WORKSPACE_UNDO_DIR);
    Ok(undo_dir.join(format!("{parsed}.patch")))
}

fn store_workspace_undo_patch(app: &AppHandle, patch: &[u8]) -> Result<String, AppError> {
    let token = uuid::Uuid::new_v4().to_string();
    let patch_path = workspace_undo_patch_path(app, &token)?;
    let undo_dir = patch_path
        .parent()
        .ok_or_else(|| AppError::GitError("Invalid workspace undo directory".to_string()))?;
    std::fs::create_dir_all(undo_dir).map_err(|e| {
        AppError::GitError(format!("Failed to create workspace undo directory: {e}"))
    })?;
    std::fs::write(&patch_path, patch)
        .map_err(|e| AppError::GitError(format!("Failed to save workspace undo patch: {e}")))?;
    Ok(token)
}

async fn undo_workspace_patch(repo_path: &Path, patch: &[u8]) -> Result<(), AppError> {
    // The reverse dry-run prevents Undo from overwriting edits made after the
    // agent patch was published. Conflicting follow-up work is left untouched.
    run_git_apply(
        repo_path,
        patch,
        &["--reverse", "--check"],
        "workspace undo check",
    )
    .await?;
    run_git_apply(repo_path, patch, &["--reverse"], "workspace undo").await
}

#[tauri::command]
pub async fn git_detect_repo(start_path: String) -> Result<Option<String>, AppError> {
    detect_git_repository(Path::new(&start_path))
        .await
        .map(|path| path.map(|path| path.to_string_lossy().into_owned()))
}

async fn detect_git_repository(start_path: &Path) -> Result<Option<PathBuf>, AppError> {
    if !start_path.exists() {
        return Ok(None);
    }
    let search_root = if start_path.is_file() {
        start_path.parent().ok_or_else(|| {
            AppError::GitError("Cannot inspect a repository from this path".to_string())
        })?
    } else {
        start_path
    };
    let output = Command::new("git")
        .arg("-C")
        .arg(search_root)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to detect Git repository: {e}")))?;
    if !output.status.success() {
        return Ok(None);
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Ok(None);
    }
    Path::new(&root)
        .canonicalize()
        .map(Some)
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize Git repository: {e}")))
}

#[tauri::command]
pub async fn git_get_status(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: Option<String>,
    run_token: Option<String>,
) -> Result<GitStatus, AppError> {
    let repo_path = get_and_validate_git_project(
        &state,
        &project_id,
        false,
        worktree_path.as_deref(),
        true,
        run_token.as_deref(),
    )?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    if !repo_path.exists() {
        return Err(AppError::GitError(
            "Repository path does not exist".to_string(),
        ));
    }

    // 1. Check if inside work tree
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to execute git: {}", e)))?;

    if !output.status.success() {
        return Ok(GitStatus {
            is_repo: false,
            path: repo_path_str,
            branch: String::new(),
            is_dirty: false,
            staged_files: Vec::new(),
            unstaged_files: Vec::new(),
            ahead: 0,
            behind: 0,
        });
    }

    // 2. Get current branch
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("branch")
        .arg("--show-current")
        .output()
        .await
        .map_err(|e| AppError::GitError(e.to_string()))?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // 3. Enumerate untracked files rather than collapsing their parent folders
    // (for example, report `.claude/skills.md`, never `.claude/`).
    let status_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output()
        .await
        .map_err(|e| AppError::GitError(e.to_string()))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let mut staged_files = Vec::new();
    let mut unstaged_files = Vec::new();
    let mut is_dirty = false;

    for line in status_str.lines() {
        if line.len() < 3 {
            continue;
        }
        let index_status = &line[0..1];
        let work_tree_status = &line[1..2];
        let file_path = line[3..].to_string();

        is_dirty = true;

        // XY status porcelain
        // X = staged status
        // Y = unstaged status
        if index_status != " " && index_status != "?" {
            staged_files.push(file_path.clone());
        }
        if work_tree_status != " " || index_status == "?" {
            unstaged_files.push(file_path);
        }
    }

    // 4. Ahead / Behind tracking
    let mut ahead = 0;
    let mut behind = 0;
    let rev_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg("HEAD...HEAD@{u}")
        .output()
        .await;

    if let Ok(output) = rev_output {
        if output.status.success() {
            let rev_str = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = rev_str.split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].parse::<u32>().unwrap_or(0);
                behind = parts[1].parse::<u32>().unwrap_or(0);
            }
        }
    }

    Ok(GitStatus {
        is_repo: true,
        path: repo_path_str,
        branch,
        is_dirty,
        staged_files,
        unstaged_files,
        ahead,
        behind,
    })
}

async fn create_commit_in_repository(
    repo_path: &Path,
    message: &str,
    files: Option<&[String]>,
    author_name: Option<&str>,
    author_email: Option<&str>,
    bypass_hooks: bool,
) -> Result<String, AppError> {
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    if files.is_some_and(<[String]>::is_empty) {
        return Err(AppError::GitError(
            "A scoped commit requires at least one file".to_string(),
        ));
    }

    // 1. Stage the requested scope. A later `git commit --only` prevents
    // unrelated paths that the user already staged from entering this commit.
    if let Some(file_list) = files {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&repo_path_str).arg("add").arg("--");
        for file in file_list {
            cmd.arg(file);
        }
        let add_output = cmd
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to stage files: {}", e)))?;
        if !add_output.status.success() {
            return Err(AppError::GitError(
                String::from_utf8_lossy(&add_output.stderr).to_string(),
            ));
        }
    } else {
        // Stage all changes
        let add_output = Command::new("git")
            .arg("-C")
            .arg(&repo_path_str)
            .arg("add")
            .arg("-A")
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to stage changes: {}", e)))?;
        if !add_output.status.success() {
            return Err(AppError::GitError(
                String::from_utf8_lossy(&add_output.stderr).to_string(),
            ));
        }
    }

    // 2. Commit
    let mut commit_cmd = Command::new("git");
    commit_cmd
        .arg("-C")
        .arg(&repo_path_str)
        .arg("commit")
        .arg("-m")
        .arg(message);

    if bypass_hooks {
        commit_cmd.arg("--no-verify");
    }
    if let Some(file_list) = files {
        commit_cmd.arg("--only").arg("--");
        for file in file_list {
            commit_cmd.arg(file);
        }
    }

    // Apply identity overrides
    if let Some(name) = author_name {
        commit_cmd.env("GIT_AUTHOR_NAME", name);
        commit_cmd.env("GIT_COMMITTER_NAME", name);
    }
    if let Some(email) = author_email {
        commit_cmd.env("GIT_AUTHOR_EMAIL", email);
        commit_cmd.env("GIT_COMMITTER_EMAIL", email);
    }

    let commit_output = commit_cmd
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to commit changes: {}", e)))?;

    if !commit_output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&commit_output.stderr).to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_create_commit(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
    author_name: Option<String>,
    author_email: Option<String>,
    bypass_hooks: bool,
    worktree_path: Option<String>,
    run_token: Option<String>,
) -> Result<String, AppError> {
    let repo_path = get_and_validate_git_project(
        &state,
        &project_id,
        true,
        worktree_path.as_deref(),
        true,
        run_token.as_deref(),
    )?;
    create_commit_in_repository(
        &repo_path,
        &message,
        files.as_deref(),
        author_name.as_deref(),
        author_email.as_deref(),
        bypass_hooks,
    )
    .await
}

#[tauri::command]
pub async fn git_undo_last_commit(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false, None)?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // Require native confirmation dialog for destructive action
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message("Are you sure you want to undo the last commit? This will perform a soft reset, preserving your changes in the staging area.")
        .title("Undo Last Commit Confirmation")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });

    let confirmed = rx.await.unwrap_or(false);

    if !confirmed {
        return Err(AppError::GitError(
            "Undo commit cancelled by user".to_string(),
        ));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("reset")
        .arg("--soft")
        .arg("HEAD~1")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to undo last commit: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    branch: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false, None)?;

    switch_branch_in_repository(&repo_path, &branch).await
}

fn git_switch_is_unavailable(stderr: &[u8]) -> bool {
    let message = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    message.contains("is not a git command") || message.contains("unknown subcommand: 'switch'")
}

async fn switch_branch_in_repository(repo_path: &Path, branch: &str) -> Result<(), AppError> {
    let validation = Command::new("git")
        .arg("check-ref-format")
        .arg("--branch")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to validate branch name: {e}")))?;

    if !validation.status.success() {
        return Err(AppError::GitError(format!(
            "Invalid Git branch name: {branch}"
        )));
    }

    let status = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--untracked-files=normal")
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to inspect repository state: {e}")))?;

    if !status.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to inspect repository state: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        )));
    }

    if !status.stdout.is_empty() {
        return Err(AppError::GitError(
            "Cannot switch branches while the repository has staged, unstaged, or untracked changes. Commit or stash them first."
                .to_string(),
        ));
    }

    // `git switch` attaches a detached HEAD to the requested branch. Git versions
    // older than 2.23 do not provide it, so fall back only when the subcommand is
    // unavailable. The branch has already passed Git's ref-name validation.
    let switch_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("switch")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to switch branch: {e}")))?;

    if switch_output.status.success() {
        return Ok(());
    }

    if !git_switch_is_unavailable(&switch_output.stderr) {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&switch_output.stderr)
                .trim()
                .to_string(),
        ));
    }

    let checkout_output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("checkout")
        .arg(branch)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to switch branch with legacy Git: {e}")))?;

    if !checkout_output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&checkout_output.stderr)
                .trim()
                .to_string(),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_diff_changes(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: Option<String>,
    files: Option<Vec<String>>,
    run_token: Option<String>,
) -> Result<String, AppError> {
    let repo_path = get_and_validate_git_project(
        &state,
        &project_id,
        false,
        worktree_path.as_deref(),
        true,
        run_token.as_deref(),
    )?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let worktree_baseline = if worktree_path.is_some() {
        resolve_optional_worktree_baseline(&repo_path).await?
    } else {
        None
    };

    let mut combined_diff = String::new();

    if let Some(baseline) = worktree_baseline.as_deref() {
        // A worktree may contain both committed and uncommitted agent edits.
        // Comparing its live filesystem to the private creation baseline keeps
        // Review complete without including the user's pre-existing dirty state.
        let mut diff_cmd = Command::new("git");
        diff_cmd
            .arg("-C")
            .arg(&repo_path_str)
            .arg("diff")
            .arg(baseline)
            .arg("--");
        if let Some(file_list) = files.as_ref() {
            diff_cmd.args(file_list);
        }
        let output = diff_cmd
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to run worktree git diff: {e}")))?;
        if !output.status.success() {
            return Err(AppError::GitError(format!(
                "Failed to run worktree git diff: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        combined_diff.push_str(&String::from_utf8_lossy(&output.stdout));
    } else {
        let mut diff_cmd = Command::new("git");
        diff_cmd.arg("-C").arg(&repo_path_str).arg("diff").arg("--");
        if let Some(file_list) = files.as_ref() {
            diff_cmd.args(file_list);
        }
        let output = diff_cmd
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to run git diff: {e}")))?;
        if !output.status.success() {
            return Err(AppError::GitError(format!(
                "Failed to run git diff: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        if !output.stdout.is_empty() {
            combined_diff.push_str("--- UNSTAGED CHANGES ---\n");
            combined_diff.push_str(&String::from_utf8_lossy(&output.stdout));
        }

        // Also include cached diff (staged).
        let mut cached_diff_cmd = Command::new("git");
        cached_diff_cmd
            .arg("-C")
            .arg(&repo_path_str)
            .arg("diff")
            .arg("--cached")
            .arg("--");
        if let Some(file_list) = files.as_ref() {
            cached_diff_cmd.args(file_list);
        }
        let cached_output = cached_diff_cmd
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to run git diff --cached: {e}")))?;
        if !cached_output.status.success() {
            return Err(AppError::GitError(format!(
                "Failed to run git diff --cached: {}",
                String::from_utf8_lossy(&cached_output.stderr).trim()
            )));
        }
        if !cached_output.stdout.is_empty() {
            if !combined_diff.is_empty() {
                combined_diff.push('\n');
            }
            combined_diff.push_str("--- STAGED CHANGES ---\n");
            combined_diff.push_str(&String::from_utf8_lossy(&cached_output.stdout));
        }
    }

    // `git diff` omits untracked files. Add no-index patches so newly created
    // files report real line counts and render normally in Review.
    let mut untracked_cmd = Command::new("git");
    untracked_cmd.arg("-C").arg(&repo_path_str).args([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
    ]);
    if let Some(file_list) = files.as_ref() {
        untracked_cmd.args(file_list);
    }
    let untracked_output = untracked_cmd
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to list untracked files: {e}")))?;
    if !untracked_output.status.success() {
        return Err(AppError::GitError(format!(
            "Failed to list untracked files: {}",
            String::from_utf8_lossy(&untracked_output.stderr).trim()
        )));
    }
    for raw_path in untracked_output.stdout.split(|byte| *byte == 0) {
        if raw_path.is_empty() {
            continue;
        }
        let path = String::from_utf8(raw_path.to_vec()).map_err(|_| {
            AppError::GitError("Git returned a non-UTF-8 untracked path".to_string())
        })?;
        resolve_git_relative_path(&repo_path, &path)?;
        let patch_output = Command::new("git")
            .arg("-C")
            .arg(&repo_path_str)
            .args(["diff", "--no-index", "--binary", "--", "/dev/null"])
            .arg(&path)
            .output()
            .await
            .map_err(|e| {
                AppError::GitError(format!("Failed to diff untracked file {path}: {e}"))
            })?;
        if !matches!(patch_output.status.code(), Some(0 | 1)) {
            return Err(AppError::GitError(format!(
                "Failed to diff untracked file {path}: {}",
                String::from_utf8_lossy(&patch_output.stderr).trim()
            )));
        }
        if patch_output.stdout.is_empty() {
            continue;
        }
        if !combined_diff.is_empty() {
            combined_diff.push('\n');
        }
        combined_diff.push_str("--- UNTRACKED CHANGE ---\n");
        combined_diff.push_str(&String::from_utf8_lossy(&patch_output.stdout));
    }

    Ok(combined_diff)
}

#[tauri::command]
pub async fn git_workspace_snapshot_create(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    run_token: String,
) -> Result<bool, AppError> {
    let project_root =
        get_and_validate_git_project(&state, &project_id, true, None, false, Some(&run_token))?;
    if detect_git_repository(&project_root).await?.is_none() {
        return Ok(false);
    }

    let snapshot_root = std::env::temp_dir().join("sythoria-workspace-snapshots");
    std::fs::create_dir_all(&snapshot_root).map_err(|e| {
        AppError::GitError(format!("Failed to create workspace snapshot root: {e}"))
    })?;
    let snapshot_id = uuid::Uuid::new_v4().simple().to_string();
    let baseline =
        create_workspace_snapshot_commit(&project_root, &snapshot_root, &snapshot_id[0..8]).await?;
    crate::project::set_project_run_workspace_baseline(&state, &run_token, &project_id, baseline)
        .map_err(|e| AppError::GitError(e.to_string()))?;
    Ok(true)
}

#[tauri::command]
pub async fn git_workspace_snapshot_finish(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    run_token: String,
) -> Result<Option<WorkspaceSnapshotResult>, AppError> {
    let Some(baseline) =
        crate::project::project_run_workspace_baseline(&state, &run_token, &project_id)
            .map_err(|e| AppError::GitError(e.to_string()))?
    else {
        return Ok(None);
    };
    let project_root =
        get_and_validate_git_project(&state, &project_id, true, None, false, Some(&run_token))?;
    let snapshot_root = std::env::temp_dir().join("sythoria-workspace-snapshots");
    std::fs::create_dir_all(&snapshot_root).map_err(|e| {
        AppError::GitError(format!("Failed to create workspace snapshot root: {e}"))
    })?;
    let snapshot_id = uuid::Uuid::new_v4().simple().to_string();
    let current =
        create_workspace_snapshot_commit(&project_root, &snapshot_root, &snapshot_id[0..8]).await?;
    let changes = diff_workspace_snapshots(&project_root, &baseline, &current).await?;
    let undo_token = if changes.patch.is_empty() {
        None
    } else {
        Some(store_workspace_undo_patch(&app, &changes.patch)?)
    };
    let diff = String::from_utf8(changes.patch)
        .map_err(|_| AppError::GitError("Git returned a non-UTF-8 workspace patch".to_string()))?;
    crate::project::clear_project_run_workspace_baseline(&state, &run_token, &project_id)
        .map_err(|e| AppError::GitError(e.to_string()))?;

    Ok(Some(WorkspaceSnapshotResult {
        changed_paths: changes.changed_paths,
        diff,
        undo_token,
    }))
}

#[tauri::command]
pub async fn git_workspace_undo(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    undo_token: String,
) -> Result<(), AppError> {
    git_worktree_undo(app, state, project_id, undo_token).await
}

#[cfg(test)]
async fn create_worktree_for_project(
    state: &crate::project::ProjectRegistry,
    project_id: &str,
    conversation_id: &str,
) -> Result<(String, String, String), AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;
    if project.permissions == crate::project::ProjectPermission::Read {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }
    let repo_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // 1. Generate unique branch name and worktree path
    let uuid = uuid::Uuid::new_v4().to_string();
    let branch_name = format!("sythoria-agent-{}", &uuid[0..8]);

    let worktree_root = crate::project::sythoria_worktree_root();
    std::fs::create_dir_all(&worktree_root)
        .map_err(|e| AppError::GitError(format!("Failed to create worktree root: {e}")))?;
    let temp_dir = worktree_root.join(&uuid[0..8]);
    let worktree_path_str = temp_dir.to_string_lossy().into_owned();
    let snapshot_commit =
        create_workspace_snapshot_commit(&repo_path, &worktree_root, &uuid[0..8]).await?;

    // 2. Create the isolated worktree from the current working-copy snapshot.
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch_name)
        .arg(&worktree_path_str)
        .arg(&snapshot_commit)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to run git worktree add: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::GitError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let baseline_ref = worktree_baseline_ref(&branch_name);
    let baseline_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path_str)
        .args(["update-ref", &baseline_ref, &snapshot_commit])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to record worktree baseline: {e}")))?;
    if !baseline_output.status.success() {
        let cleanup_error =
            cleanup_worktree_internal(&project, &repo_path_str, &worktree_path_str, &branch_name)
                .await
                .err();
        let cleanup_detail = cleanup_error
            .map(|cleanup| format!(" Cleanup also failed: {cleanup}"))
            .unwrap_or_default();
        return Err(AppError::GitError(format!(
            "Failed to record worktree baseline: {}.{cleanup_detail}",
            String::from_utf8_lossy(&baseline_output.stderr).trim()
        )));
    }

    if let Err(error) =
        crate::project::validate_owned_worktree(&project, &worktree_path_str, Some(&branch_name))
    {
        let cleanup_error =
            cleanup_worktree_internal(&project, &repo_path_str, &worktree_path_str, &branch_name)
                .await
                .err();
        let cleanup_detail = cleanup_error
            .map(|cleanup| format!(" Cleanup also failed: {cleanup}"))
            .unwrap_or_default();
        return Err(AppError::GitError(format!(
            "Failed to validate created worktree: {error}.{cleanup_detail}"
        )));
    }

    let run_token = crate::project::register_project_run(
        state,
        project_id,
        conversation_id,
        Some(&worktree_path_str),
        Some(&branch_name),
    );

    let run_token = match run_token {
        Ok(run_token) => run_token,
        Err(error) => {
            let cleanup_error = cleanup_worktree_internal(
                &project,
                &repo_path_str,
                &worktree_path_str,
                &branch_name,
            )
            .await
            .err();
            let cleanup_detail = cleanup_error
                .map(|cleanup| format!(" Cleanup also failed: {cleanup}"))
                .unwrap_or_default();
            return Err(AppError::GitError(format!(
                "Failed to register project run: {error}.{cleanup_detail}"
            )));
        }
    };

    Ok((worktree_path_str, branch_name, run_token))
}

#[tauri::command]
pub async fn git_worktree_apply(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: String,
    branch_name: String,
) -> Result<WorktreeApplyResult, AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;
    if project.permissions == crate::project::ProjectPermission::Read {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }
    let repo_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let verified =
        crate::project::validate_owned_worktree(&project, &worktree_path, Some(&branch_name))
            .map_err(|e| AppError::GitError(e.to_string()))?;
    let worktree_dir = verified.path;

    // Cleanup is intentionally unreachable until the complete patch has been
    // applied and independently verified by Git.
    let applied = apply_worktree_changes(&repo_path, &worktree_dir).await?;
    let undo_token = if applied.patch.is_empty() {
        None
    } else {
        Some(store_workspace_undo_patch(&app, &applied.patch)?)
    };
    cleanup_worktree_internal(&project, &repo_path_str, &worktree_path, &branch_name).await?;

    Ok(WorktreeApplyResult {
        changed_paths: applied.changed_paths,
        undo_token,
    })
}

#[tauri::command]
pub async fn git_worktree_undo(
    app: AppHandle,
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    undo_token: String,
) -> Result<(), AppError> {
    let repo_path = get_and_validate_git_project(&state, &project_id, true, None, false, None)?;
    let patch_path = workspace_undo_patch_path(&app, &undo_token)?;
    let patch = std::fs::read(&patch_path)
        .map_err(|e| AppError::GitError(format!("This change can no longer be undone: {e}")))?;

    undo_workspace_patch(&repo_path, &patch).await?;
    std::fs::remove_file(&patch_path)
        .map_err(|e| AppError::GitError(format!("Changes were undone, but cleanup failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_worktree_cleanup_if_empty(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: String,
    branch_name: String,
) -> Result<bool, AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;
    let repo_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let verified =
        crate::project::validate_owned_worktree(&project, &worktree_path, Some(&branch_name))
            .map_err(|e| AppError::GitError(e.to_string()))?;

    if worktree_has_changes(&repo_path, &verified.path).await? {
        return Ok(false);
    }

    cleanup_worktree_internal(&project, &repo_path_str, &worktree_path, &branch_name).await?;
    Ok(true)
}

#[tauri::command]
pub async fn git_worktree_discard(
    state: tauri::State<'_, crate::project::ProjectRegistry>,
    project_id: String,
    worktree_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::GitError("Poisoned lock".to_string()))?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::GitError("Access denied: Project not found in registry".to_string())
        })?;
    if project.permissions == crate::project::ProjectPermission::Read {
        return Err(AppError::GitError(
            "Permission denied: write access not allowed".to_string(),
        ));
    }
    let repo_path = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::GitError(format!("Failed to canonicalize project root: {e}")))?;
    let repo_path_str = repo_path.to_string_lossy().into_owned();

    // Clean up worktree and delete temp branch
    cleanup_worktree_internal(&project, &repo_path_str, &worktree_path, &branch_name).await?;

    Ok(())
}

fn validate_stale_worktree_identity(
    worktree_path: &str,
    branch_name: &str,
) -> Result<PathBuf, AppError> {
    let suffix = branch_name
        .strip_prefix("sythoria-agent-")
        .filter(|suffix| suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            AppError::GitError(
                "Access denied: stale worktree branch is not owned by Sythoria".to_string(),
            )
        })?;
    let expected_path = crate::project::sythoria_worktree_root().join(suffix);
    if Path::new(worktree_path) != expected_path {
        return Err(AppError::GitError(
            "Access denied: stale worktree path does not match its Sythoria branch".to_string(),
        ));
    }
    Ok(expected_path)
}

async fn cleanup_worktree_internal(
    project: &crate::project::Project,
    repo_path: &str,
    worktree_path: &str,
    branch_name: &str,
) -> Result<(), AppError> {
    let cleanup_path =
        match crate::project::validate_owned_worktree(project, worktree_path, Some(branch_name)) {
            Ok(verified) => {
                // Remove a live, verified worktree through Git. Never recursively
                // delete a renderer-supplied path as a fallback.
                let remove_output = Command::new("git")
                    .arg("-C")
                    .arg(repo_path)
                    .arg("worktree")
                    .arg("remove")
                    .arg("--force")
                    .arg("--")
                    .arg(&verified.path)
                    .output()
                    .await
                    .map_err(|e| {
                        AppError::GitError(format!("Failed to remove git worktree: {e}"))
                    })?;

                if !remove_output.status.success() {
                    return Err(AppError::GitError(format!(
                        "Git refused to remove the verified worktree: {}",
                        String::from_utf8_lossy(&remove_output.stderr).trim()
                    )));
                }
                verified.path
            }
            Err(_) if !Path::new(worktree_path).exists() => {
                let expected_path = validate_stale_worktree_identity(worktree_path, branch_name)?;

                // The directory was removed outside Sythoria. Prune Git's stale
                // registration before deleting the reserved temporary branch.
                let prune_output = Command::new("git")
                    .arg("-C")
                    .arg(repo_path)
                    .arg("worktree")
                    .arg("prune")
                    .arg("--expire")
                    .arg("now")
                    .output()
                    .await
                    .map_err(|e| {
                        AppError::GitError(format!("Failed to prune stale worktree metadata: {e}"))
                    })?;
                if !prune_output.status.success() {
                    return Err(AppError::GitError(format!(
                        "Git refused to prune stale worktree metadata: {}",
                        String::from_utf8_lossy(&prune_output.stderr).trim()
                    )));
                }
                expected_path
            }
            Err(error) => return Err(AppError::GitError(error.to_string())),
        };

    let branch_ref = format!("refs/heads/{branch_name}");
    let branch_check = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("show-ref")
        .arg("--verify")
        .arg("--quiet")
        .arg(&branch_ref)
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to inspect temporary branch: {e}")))?;

    if branch_check.status.success() {
        let delete_output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("-D")
            .arg("--")
            .arg(branch_name)
            .output()
            .await
            .map_err(|e| AppError::GitError(format!("Failed to delete temporary branch: {e}")))?;

        if !delete_output.status.success() {
            return Err(AppError::GitError(format!(
                "Worktree was removed, but its temporary branch could not be deleted: {}",
                String::from_utf8_lossy(&delete_output.stderr).trim()
            )));
        }
    } else if branch_check.status.code() != Some(1) {
        return Err(AppError::GitError(format!(
            "Git could not determine whether the temporary branch exists: {}",
            String::from_utf8_lossy(&branch_check.stderr).trim()
        )));
    }

    let baseline_ref = worktree_baseline_ref(branch_name);
    let baseline_delete = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["update-ref", "-d", &baseline_ref])
        .output()
        .await
        .map_err(|e| AppError::GitError(format!("Failed to delete worktree baseline: {e}")))?;
    if !baseline_delete.status.success() {
        return Err(AppError::GitError(format!(
            "Worktree was removed, but its baseline reference could not be deleted: {}",
            String::from_utf8_lossy(&baseline_delete.stderr).trim()
        )));
    }

    if cleanup_path.exists() {
        return Err(AppError::GitError(
            "Git reported success but the worktree directory still exists".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_worktree_changes, cleanup_worktree_internal, create_commit_in_repository,
        create_workspace_snapshot_commit, create_worktree_for_project, detect_git_repository,
        diff_workspace_snapshots, parse_changed_paths, resolve_git_relative_path,
        switch_branch_in_repository, undo_workspace_patch, validate_stale_worktree_identity,
        worktree_has_changes,
    };
    use crate::project::{
        validate_project_run_access, Project, ProjectPermission, ProjectRegistry,
    };
    use std::path::Path;
    use std::process::Command as StdCommand;

    struct TestRepository {
        root: std::path::PathBuf,
        repo: std::path::PathBuf,
        worktree: std::path::PathBuf,
    }

    impl TestRepository {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "sythoria-worktree-apply-test-{}",
                uuid::Uuid::new_v4()
            ));
            let repo = root.join("repo");
            let worktree = root.join("worktree");
            std::fs::create_dir_all(&repo).expect("create test repository");
            run_git(&repo, &["init"]);
            run_git(&repo, &["config", "user.email", "tests@sythoria.invalid"]);
            run_git(&repo, &["config", "user.name", "Sythoria Tests"]);
            run_git(&repo, &["config", "commit.gpgsign", "false"]);
            run_git(&repo, &["config", "core.autocrlf", "false"]);
            std::fs::write(repo.join("modified.txt"), b"original\n").expect("write fixture");
            std::fs::write(repo.join("deleted.txt"), b"delete me\n").expect("write fixture");
            std::fs::write(repo.join("user.txt"), b"user original\n").expect("write fixture");
            run_git(&repo, &["add", "."]);
            run_git(&repo, &["commit", "-m", "initial"]);
            run_git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "-b",
                    "sythoria-agent-test",
                    worktree.to_str().expect("UTF-8 test path"),
                ],
            );

            Self {
                root,
                repo,
                worktree,
            }
        }
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn run_git(repo: &Path, args: &[&str]) {
        let output = StdCommand::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run Git test command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn register_project(registry: &ProjectRegistry, repo: &Path) {
        registry
            .projects
            .lock()
            .expect("lock project registry")
            .insert(
                "project".to_string(),
                Project {
                    id: "project".to_string(),
                    name: "Project".to_string(),
                    path: repo.to_string_lossy().into_owned(),
                    permissions: ProjectPermission::Write,
                    skip_command_confirmations: None,
                    exclude_patterns: None,
                    system_prompt_override: None,
                    model_override: None,
                    is_auto_commit_enabled: None,
                    auto_commit_msg_template: None,
                },
            );
    }

    #[test]
    fn git_paths_cannot_escape_the_workspace() {
        let root = std::env::current_dir().expect("current directory");
        assert!(resolve_git_relative_path(&root, "src/lib.rs").is_ok());
        assert!(resolve_git_relative_path(&root, "../outside").is_err());
        assert!(resolve_git_relative_path(&root, "/outside").is_err());
        assert!(resolve_git_relative_path(&root, "").is_err());
    }

    #[test]
    fn changed_path_parser_rejects_malformed_or_unsupported_entries() {
        assert_eq!(
            parse_changed_paths(b"A\0nested/file.txt\0M\0other.txt\0").expect("valid paths"),
            ["nested/file.txt", "other.txt"]
        );
        assert!(parse_changed_paths(b"A\0").is_err());
        assert!(parse_changed_paths(b"R100\0old.txt\0new.txt\0").is_err());
        assert!(parse_changed_paths(b"A\0../outside\0").is_ok());
    }

    #[tokio::test]
    async fn direct_workspace_snapshots_capture_and_reverse_only_run_changes() {
        let fixture = TestRepository::new();
        let snapshot_root = fixture.root.join("snapshots");
        std::fs::create_dir_all(&snapshot_root).expect("create snapshot root");
        let baseline = create_workspace_snapshot_commit(&fixture.repo, &snapshot_root, "baseline")
            .await
            .expect("capture baseline");

        std::fs::write(fixture.repo.join("modified.txt"), b"agent change\n")
            .expect("modify tracked file directly");
        std::fs::write(fixture.repo.join("created.txt"), b"created directly\n")
            .expect("create direct file");

        let current = create_workspace_snapshot_commit(&fixture.repo, &snapshot_root, "current")
            .await
            .expect("capture current workspace");
        let changes = diff_workspace_snapshots(&fixture.repo, &baseline, &current)
            .await
            .expect("diff direct workspace snapshots");

        assert_eq!(changes.changed_paths, ["created.txt", "modified.txt"]);
        undo_workspace_patch(&fixture.repo, &changes.patch)
            .await
            .expect("reverse exact direct changes");
        assert!(!fixture.repo.join("created.txt").exists());
        assert_eq!(
            std::fs::read_to_string(fixture.repo.join("modified.txt")).expect("read restored file"),
            "original\n"
        );
    }

    #[test]
    fn stale_worktree_identity_requires_the_reserved_path_and_branch_pair() {
        let branch = "sythoria-agent-a1b2c3d4";
        let expected = crate::project::sythoria_worktree_root().join("a1b2c3d4");

        assert_eq!(
            validate_stale_worktree_identity(&expected.to_string_lossy(), branch)
                .expect("validate owned stale identity"),
            expected
        );
        assert!(validate_stale_worktree_identity("/tmp/unrelated", branch).is_err());
        assert!(validate_stale_worktree_identity(
            &crate::project::sythoria_worktree_root()
                .join("a1b2c3d4")
                .to_string_lossy(),
            "feature/user-branch",
        )
        .is_err());
    }

    #[tokio::test]
    async fn repository_detection_supports_linked_worktrees() {
        let fixture = TestRepository::new();
        let nested = fixture.worktree.join("nested");
        std::fs::create_dir_all(&nested).expect("create nested worktree directory");

        assert_eq!(
            detect_git_repository(&nested)
                .await
                .expect("detect linked worktree"),
            Some(
                fixture
                    .worktree
                    .canonicalize()
                    .expect("canonical linked worktree"),
            )
        );
    }

    #[tokio::test]
    async fn worktree_creation_registers_a_write_capability_without_hanging() {
        let fixture = TestRepository::new();
        let registry = ProjectRegistry::new();
        register_project(&registry, &fixture.repo);

        let (worktree_path, branch, run_token) = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            create_worktree_for_project(&registry, "project", "conversation"),
        )
        .await
        .expect("worktree creation timed out")
        .expect("create registered worktree");

        let root = validate_project_run_access(
            &registry,
            &run_token,
            "project",
            Some(&worktree_path),
            true,
        )
        .expect("validate write capability")
        .expect("write capability has worktree");
        assert_eq!(
            root,
            Path::new(&worktree_path)
                .canonicalize()
                .expect("canonical created worktree"),
        );

        let project = registry
            .projects
            .lock()
            .expect("lock project registry")
            .get("project")
            .expect("registered project")
            .clone();
        cleanup_worktree_internal(
            &project,
            &fixture.repo.to_string_lossy(),
            &worktree_path,
            &branch,
        )
        .await
        .expect("clean up created worktree");
    }

    #[tokio::test]
    async fn worktree_creation_snapshots_current_project_files_without_reapplying_them() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.repo.join("modified.txt"), b"user working copy\n")
            .expect("modify tracked project file");
        std::fs::write(fixture.repo.join("main.py"), b"print('user copy')\n")
            .expect("create untracked project file");

        let registry = ProjectRegistry::new();
        register_project(&registry, &fixture.repo);
        let (worktree_path, branch, _) =
            create_worktree_for_project(&registry, "project", "conversation")
                .await
                .expect("create snapshot worktree");
        let worktree = Path::new(&worktree_path);

        assert_eq!(
            std::fs::read(worktree.join("modified.txt")).expect("read tracked snapshot"),
            b"user working copy\n"
        );
        assert_eq!(
            std::fs::read(worktree.join("main.py")).expect("read untracked snapshot"),
            b"print('user copy')\n"
        );
        assert!(!worktree_has_changes(&fixture.repo, worktree)
            .await
            .expect("snapshot itself is not an agent change"));

        std::fs::write(worktree.join("main.py"), b"print('agent edit')\n")
            .expect("edit snapshotted file");
        let applied = apply_worktree_changes(&fixture.repo, worktree)
            .await
            .expect("apply only agent delta");

        assert_eq!(applied.changed_paths, ["main.py".to_string()]);
        assert_eq!(
            std::fs::read(fixture.repo.join("main.py")).expect("read applied agent edit"),
            b"print('agent edit')\n"
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read preserved user change"),
            b"user working copy\n"
        );

        let project = registry
            .projects
            .lock()
            .expect("lock project registry")
            .get("project")
            .expect("registered project")
            .clone();
        cleanup_worktree_internal(
            &project,
            &fixture.repo.to_string_lossy(),
            &worktree_path,
            &branch,
        )
        .await
        .expect("clean up snapshot worktree");
    }

    #[tokio::test]
    async fn worktree_creation_snapshots_files_from_an_unborn_repository() {
        let root = std::env::temp_dir().join(format!(
            "sythoria-unborn-snapshot-test-{}",
            uuid::Uuid::new_v4()
        ));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).expect("create unborn repository");
        run_git(&repo, &["init"]);
        std::fs::write(repo.join("main.py"), b"print('exists')\n")
            .expect("create untracked project file");

        let registry = ProjectRegistry::new();
        register_project(&registry, &repo);
        let (worktree_path, branch, _) =
            create_worktree_for_project(&registry, "project", "conversation")
                .await
                .expect("create unborn snapshot worktree");
        let worktree = Path::new(&worktree_path);

        assert_eq!(
            std::fs::read(worktree.join("main.py")).expect("read unborn snapshot"),
            b"print('exists')\n"
        );
        assert!(!worktree_has_changes(&repo, worktree)
            .await
            .expect("unborn snapshot itself is not an agent change"));

        let project = registry
            .projects
            .lock()
            .expect("lock project registry")
            .get("project")
            .expect("registered project")
            .clone();
        cleanup_worktree_internal(&project, &repo.to_string_lossy(), &worktree_path, &branch)
            .await
            .expect("clean up unborn snapshot worktree");
        std::fs::remove_dir_all(root).expect("clean up unborn repository");
    }

    #[tokio::test]
    async fn worktree_cleanup_succeeds_when_the_owned_directory_is_already_missing() {
        let fixture = TestRepository::new();
        let registry = ProjectRegistry::new();
        register_project(&registry, &fixture.repo);

        let (worktree_path, branch, _) =
            create_worktree_for_project(&registry, "project", "conversation")
                .await
                .expect("create registered worktree");
        std::fs::remove_dir_all(&worktree_path).expect("remove worktree outside Sythoria");

        let project = registry
            .projects
            .lock()
            .expect("lock project registry")
            .get("project")
            .expect("registered project")
            .clone();
        cleanup_worktree_internal(
            &project,
            &fixture.repo.to_string_lossy(),
            &worktree_path,
            &branch,
        )
        .await
        .expect("clean up stale worktree record");

        let branch_ref = format!("refs/heads/{branch}");
        let branch_status = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["show-ref", "--verify", "--quiet", &branch_ref])
            .status()
            .expect("inspect temporary branch");
        assert_eq!(branch_status.code(), Some(1));
    }

    #[tokio::test]
    async fn branch_switch_validates_names_and_attaches_detached_head() {
        let fixture = TestRepository::new();
        run_git(&fixture.repo, &["branch", "feature/valid-branch"]);
        run_git(&fixture.repo, &["checkout", "--detach"]);

        switch_branch_in_repository(&fixture.repo, "feature/valid-branch")
            .await
            .expect("switch from detached HEAD");

        let branch = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["branch", "--show-current"])
            .output()
            .expect("read current branch");
        assert_eq!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "feature/valid-branch"
        );

        assert!(switch_branch_in_repository(&fixture.repo, "../invalid")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn branch_switch_reports_dirty_state_before_switching() {
        let fixture = TestRepository::new();
        run_git(&fixture.repo, &["branch", "feature/clean-target"]);
        std::fs::write(fixture.repo.join("modified.txt"), b"dirty\n").expect("dirty fixture");

        let error = switch_branch_in_repository(&fixture.repo, "feature/clean-target")
            .await
            .expect_err("dirty repository must not switch");

        assert!(error.to_string().contains("Commit or stash"));
        let branch = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["branch", "--show-current"])
            .output()
            .expect("read current branch");
        assert_ne!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "feature/clean-target"
        );
    }

    #[tokio::test]
    async fn worktree_apply_includes_nested_untracked_files_and_deletions() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"changed\n")
            .expect("modify fixture");
        std::fs::remove_file(fixture.worktree.join("deleted.txt")).expect("delete fixture");
        let nested = fixture.worktree.join("new/deep/tree");
        std::fs::create_dir_all(&nested).expect("create nested fixture");
        std::fs::write(nested.join("payload.bin"), [0, 1, 2, 0xff]).expect("write binary fixture");

        let applied = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply complete worktree");

        assert_eq!(
            applied.changed_paths,
            [
                "deleted.txt".to_string(),
                "modified.txt".to_string(),
                "new/deep/tree/payload.bin".to_string(),
            ]
        );

        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read modified result"),
            b"changed\n"
        );
        assert!(!fixture.repo.join("deleted.txt").exists());
        assert_eq!(
            std::fs::read(fixture.repo.join("new/deep/tree/payload.bin"))
                .expect("read nested result"),
            [0, 1, 2, 0xff]
        );
        assert!(fixture.worktree.exists(), "apply helper must not clean up");
    }

    #[tokio::test]
    async fn workspace_undo_reverses_only_the_saved_agent_patch() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"agent change\n")
            .expect("modify fixture");
        std::fs::write(fixture.worktree.join("created.txt"), b"agent file\n")
            .expect("create fixture file");

        let applied = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply agent patch");
        std::fs::write(fixture.repo.join("unrelated.txt"), b"user change\n")
            .expect("write unrelated user change");

        undo_workspace_patch(&fixture.repo, &applied.patch)
            .await
            .expect("undo exact agent patch");

        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read restored file"),
            b"original\n"
        );
        assert!(!fixture.repo.join("created.txt").exists());
        assert_eq!(
            std::fs::read(fixture.repo.join("unrelated.txt")).expect("read unrelated change"),
            b"user change\n"
        );
    }

    #[tokio::test]
    async fn workspace_undo_refuses_to_overwrite_a_follow_up_edit() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"agent change\n")
            .expect("modify fixture");
        let applied = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply agent patch");
        std::fs::write(fixture.repo.join("modified.txt"), b"later user change\n")
            .expect("write conflicting user change");

        assert!(undo_workspace_patch(&fixture.repo, &applied.patch)
            .await
            .is_err());
        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read protected user edit"),
            b"later user change\n"
        );
    }

    #[tokio::test]
    async fn empty_unborn_worktree_applies_without_resolving_head() {
        let root = std::env::temp_dir().join(format!(
            "sythoria-unborn-worktree-test-{}",
            uuid::Uuid::new_v4()
        ));
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        std::fs::create_dir_all(&repo).expect("create unborn repository");
        run_git(&repo, &["init"]);
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "sythoria-agent-unborn",
                worktree.to_str().expect("UTF-8 test path"),
            ],
        );

        let applied = apply_worktree_changes(&repo, &worktree)
            .await
            .expect("apply empty unborn worktree");

        assert!(applied.changed_paths.is_empty());
        std::fs::remove_dir_all(&root).expect("clean up unborn fixture");
    }

    #[tokio::test]
    async fn unborn_worktree_applies_its_initial_files() {
        let root = std::env::temp_dir().join(format!(
            "sythoria-unborn-worktree-changes-test-{}",
            uuid::Uuid::new_v4()
        ));
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        std::fs::create_dir_all(&repo).expect("create unborn repository");
        run_git(&repo, &["init"]);
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "sythoria-agent-unborn-changes",
                worktree.to_str().expect("UTF-8 test path"),
            ],
        );
        std::fs::write(worktree.join("created.txt"), b"first revision\n")
            .expect("write unborn fixture change");

        let applied = apply_worktree_changes(&repo, &worktree)
            .await
            .expect("apply unborn worktree changes");

        assert_eq!(applied.changed_paths, ["created.txt".to_string()]);
        assert_eq!(
            std::fs::read(repo.join("created.txt")).expect("read applied unborn file"),
            b"first revision\n"
        );
        std::fs::remove_dir_all(&root).expect("clean up unborn fixture");
    }

    #[tokio::test]
    async fn worktree_change_detection_includes_clean_branch_commits() {
        let fixture = TestRepository::new();
        assert!(!worktree_has_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("inspect unchanged worktree"));

        std::fs::write(
            fixture.worktree.join("committed.txt"),
            b"committed change\n",
        )
        .expect("write committed fixture");
        run_git(&fixture.worktree, &["add", "--", "committed.txt"]);
        run_git(&fixture.worktree, &["commit", "-m", "agent commit"]);

        assert!(worktree_has_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("inspect committed worktree change"));
    }

    #[tokio::test]
    async fn worktree_apply_includes_committed_and_uncommitted_branch_changes() {
        let fixture = TestRepository::new();
        std::fs::write(
            fixture.worktree.join("committed.txt"),
            b"committed agent change\n",
        )
        .expect("write committed fixture");
        run_git(&fixture.worktree, &["add", "--", "committed.txt"]);
        run_git(&fixture.worktree, &["commit", "-m", "agent commit"]);
        std::fs::write(
            fixture.worktree.join("uncommitted.txt"),
            b"uncommitted agent change\n",
        )
        .expect("write uncommitted fixture");

        let applied = apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .expect("apply complete branch state");

        assert_eq!(
            applied.changed_paths,
            ["committed.txt".to_string(), "uncommitted.txt".to_string()]
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("committed.txt")).expect("read committed result"),
            b"committed agent change\n"
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("uncommitted.txt")).expect("read uncommitted result"),
            b"uncommitted agent change\n"
        );
    }

    #[tokio::test]
    async fn failed_apply_keeps_worktree_and_source_changes_intact() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.worktree.join("modified.txt"), b"worktree version\n")
            .expect("modify worktree fixture");
        std::fs::write(
            fixture.repo.join("modified.txt"),
            b"conflicting primary version\n",
        )
        .expect("modify primary fixture");

        assert!(apply_worktree_changes(&fixture.repo, &fixture.worktree)
            .await
            .is_err());
        assert!(
            fixture.worktree.exists(),
            "failed apply removed its worktree"
        );
        assert_eq!(
            std::fs::read(fixture.worktree.join("modified.txt")).expect("read source change"),
            b"worktree version\n"
        );
        assert_eq!(
            std::fs::read(fixture.repo.join("modified.txt")).expect("read primary conflict"),
            b"conflicting primary version\n"
        );
    }

    #[tokio::test]
    async fn scoped_commit_preserves_unrelated_staged_changes() {
        let fixture = TestRepository::new();
        std::fs::write(fixture.repo.join("modified.txt"), b"AI change\n").expect("write AI change");
        std::fs::write(fixture.repo.join("user.txt"), b"user staged change\n")
            .expect("write user change");
        run_git(&fixture.repo, &["add", "--", "user.txt"]);

        create_commit_in_repository(
            &fixture.repo,
            "fix: scoped change",
            Some(&["modified.txt".to_string()]),
            None,
            None,
            false,
        )
        .await
        .expect("create scoped commit");

        let committed = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["show", "--pretty=format:", "--name-only", "HEAD"])
            .output()
            .expect("inspect commit");
        assert_eq!(
            String::from_utf8_lossy(&committed.stdout).trim(),
            "modified.txt"
        );

        let staged = StdCommand::new("git")
            .arg("-C")
            .arg(&fixture.repo)
            .args(["diff", "--cached", "--name-only"])
            .output()
            .expect("inspect staged paths");
        assert_eq!(String::from_utf8_lossy(&staged.stdout).trim(), "user.txt");
    }
}
