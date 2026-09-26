use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectPermission {
    Read,
    Write,
    Full,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub permissions: ProjectPermission,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_command_confirmations: Option<bool>,
    #[serde(default)]
    pub exclude_patterns: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_auto_commit_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_commit_msg_template: Option<String>,
}

pub struct ProjectRegistry {
    pub projects: Mutex<HashMap<String, Project>>,
    pub active_project_id: Mutex<Option<String>>,
    run_capabilities: Mutex<HashMap<String, ProjectRunCapability>>,
}

#[derive(Clone, Debug)]
struct ProjectRunCapability {
    conversation_id: String,
    project_id: String,
    worktree_path: Option<PathBuf>,
    branch: Option<String>,
    workspace_baseline: Option<String>,
    read_only: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ValidatedWorktree {
    pub path: PathBuf,
    pub branch: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ProjectExclusions {
    root: PathBuf,
    matcher: ignore::gitignore::Gitignore,
}

impl ProjectExclusions {
    pub(crate) fn new(project: &Project, root: &Path) -> Result<Self, AppError> {
        let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
        builder
            .case_insensitive(cfg!(target_os = "windows"))
            .map_err(|error| {
                AppError::AppPath(format!("Failed to configure project exclusions: {error}"))
            })?;

        if let Some(patterns) = &project.exclude_patterns {
            for raw_pattern in patterns {
                let Some(pattern) = normalize_exclusion_pattern(raw_pattern)? else {
                    continue;
                };
                builder.add_line(None, &pattern).map_err(|error| {
                    AppError::AppPath(format!(
                        "Invalid project exclusion pattern '{}': {error}",
                        raw_pattern.trim()
                    ))
                })?;
            }
        }

        let matcher = builder.build().map_err(|error| {
            AppError::AppPath(format!("Failed to compile project exclusions: {error}"))
        })?;
        Ok(Self {
            root: root.to_path_buf(),
            matcher,
        })
    }

    fn matching_pattern(&self, path: &Path, is_dir: bool) -> Option<&str> {
        if !path.starts_with(&self.root) {
            return None;
        }
        match self.matcher.matched_path_or_any_parents(path, is_dir) {
            ignore::Match::Ignore(glob) => Some(glob.original()),
            ignore::Match::None | ignore::Match::Whitelist(_) => None,
        }
    }

    pub(crate) fn ensure_allowed(&self, path: &Path, is_dir: bool) -> Result<(), AppError> {
        if let Some(pattern) = self.matching_pattern(path, is_dir) {
            return Err(AppError::AppPath(format!(
                "Access denied: path '{}' matches exclude pattern '{}'",
                path.display(),
                pattern
            )));
        }
        Ok(())
    }

    pub(crate) fn allows_discovered_path(&self, path: &Path, is_dir: bool) -> bool {
        if !path.starts_with(&self.root) || self.ensure_allowed(path, is_dir).is_err() {
            return false;
        }
        let Ok(canonical) = path.canonicalize() else {
            return false;
        };
        canonical.starts_with(&self.root)
            && self.ensure_allowed(&canonical, canonical.is_dir()).is_ok()
    }
}

fn normalize_exclusion_pattern(raw_pattern: &str) -> Result<Option<String>, AppError> {
    let mut pattern = raw_pattern.trim().replace('\\', "/");
    while let Some(stripped) = pattern.strip_prefix("./") {
        pattern = stripped.to_string();
    }
    if pattern.is_empty() {
        return Ok(None);
    }
    if pattern.starts_with('!') {
        return Err(AppError::AppPath(
            "Project exclusion patterns cannot use negation ('!')".to_string(),
        ));
    }
    if pattern.split('/').any(|component| component == "..") {
        return Err(AppError::AppPath(
            "Project exclusion patterns must be root-relative and cannot contain '..'".to_string(),
        ));
    }
    if pattern.starts_with('#') {
        pattern.insert(0, '\\');
    }
    Ok(Some(pattern))
}

pub(crate) fn sythoria_worktree_root() -> PathBuf {
    std::env::temp_dir().join("sythoria-worktrees")
}

fn is_sythoria_agent_branch(branch: &str) -> bool {
    branch
        .strip_prefix("sythoria-agent-")
        .is_some_and(|suffix| {
            suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn parse_git_worktrees(output: &[u8]) -> Vec<ValidatedWorktree> {
    let mut worktrees = Vec::new();
    let mut path = None;
    let mut branch = None;

    for raw_field in output.split(|byte| *byte == 0) {
        if raw_field.is_empty() {
            if let (Some(path), Some(branch)) = (path.take(), branch.take()) {
                worktrees.push(ValidatedWorktree { path, branch });
            }
            continue;
        }

        let field = String::from_utf8_lossy(raw_field);
        if let Some(value) = field.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
        } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
            branch = Some(value.to_string());
        }
    }

    if let (Some(path), Some(branch)) = (path, branch) {
        worktrees.push(ValidatedWorktree { path, branch });
    }
    worktrees
}

/// Validates that a renderer-supplied path is both inside Sythoria's dedicated
/// temporary root and registered by Git as a worktree of the selected project.
pub(crate) fn validate_owned_worktree(
    project: &Project,
    worktree_path: &str,
    expected_branch: Option<&str>,
) -> Result<ValidatedWorktree, AppError> {
    let owned_root = sythoria_worktree_root()
        .canonicalize()
        .map_err(|_| AppError::AppPath("No Sythoria worktree root is available".to_string()))?;
    let candidate = Path::new(worktree_path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Invalid worktree path: {e}")))?;

    if candidate == owned_root || !candidate.starts_with(&owned_root) {
        return Err(AppError::AppPath(
            "Access denied: worktree is outside the Sythoria-owned root".to_string(),
        ));
    }

    let project_root = Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {e}")))?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&project_root)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .arg("-z")
        .output()
        .map_err(|e| AppError::AppPath(format!("Failed to inspect Git worktrees: {e}")))?;
    if !output.status.success() {
        return Err(AppError::AppPath(
            "Access denied: project worktrees could not be verified".to_string(),
        ));
    }

    let verified = parse_git_worktrees(&output.stdout)
        .into_iter()
        .find_map(|entry| {
            let entry_path = entry.path.canonicalize().ok()?;
            (entry_path == candidate).then_some(ValidatedWorktree {
                path: entry_path,
                branch: entry.branch,
            })
        })
        .ok_or_else(|| {
            AppError::AppPath(
                "Access denied: path is not a registered worktree for this project".to_string(),
            )
        })?;

    if !is_sythoria_agent_branch(&verified.branch) {
        return Err(AppError::AppPath(
            "Access denied: worktree is not owned by Sythoria".to_string(),
        ));
    }
    if expected_branch.is_some_and(|branch| branch != verified.branch) {
        return Err(AppError::AppPath(
            "Access denied: worktree branch does not match".to_string(),
        ));
    }

    Ok(verified)
}

pub(crate) fn resolve_project_root(
    _state: &ProjectRegistry,
    project: &Project,
    _project_id: &str,
    requested_worktree: Option<&str>,
) -> Result<PathBuf, AppError> {
    if let Some(worktree) = requested_worktree {
        return Ok(validate_owned_worktree(project, worktree, None)?.path);
    }

    Path::new(&project.path)
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {e}")))
}

impl ProjectRegistry {
    pub fn new() -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
            active_project_id: Mutex::new(None),
            run_capabilities: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn load_from_disk(&self, app: &AppHandle) -> Result<(), AppError> {
        if let Some(projects) =
            secure_storage::load_json::<Vec<Project>>(app, StorageDomain::Projects)?
        {
            let mut projects_guard = self
                .projects
                .lock()
                .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
            projects_guard.clear();
            for p in projects {
                projects_guard.insert(p.id.clone(), p);
            }
        }
        Ok(())
    }
}

impl Default for ProjectRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub(crate) async fn load_projects(
    app: AppHandle,
    state: tauri::State<'_, ProjectRegistry>,
) -> Result<Vec<Project>, AppError> {
    let projects: Vec<Project> =
        secure_storage::load_json(&app, StorageDomain::Projects)?.unwrap_or_default();

    let mut projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    projects_guard.clear();
    for p in &projects {
        projects_guard.insert(p.id.clone(), p.clone());
    }
    Ok(projects)
}

#[tauri::command]
pub(crate) async fn save_projects(
    app: AppHandle,
    state: tauri::State<'_, ProjectRegistry>,
    projects: Vec<Project>,
) -> Result<(), AppError> {
    secure_storage::save_json(&app, StorageDomain::Projects, &projects)?;

    let mut projects_guard = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    projects_guard.clear();
    for p in projects {
        projects_guard.insert(p.id.clone(), p);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_active_project(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: Option<String>,
) -> Result<(), AppError> {
    let mut active_guard = state
        .active_project_id
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    *active_guard = project_id;
    Ok(())
}

pub(crate) fn register_project_run(
    state: &ProjectRegistry,
    project_id: &str,
    conversation_id: &str,
    worktree_path: Option<&str>,
    branch: Option<&str>,
) -> Result<String, AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .get(project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?;

    let (canonical_worktree, verified_branch) = match worktree_path {
        Some(path) => {
            let verified = validate_owned_worktree(&project, path, branch)?;
            (Some(verified.path), Some(verified.branch))
        }
        None => {
            if branch.is_some() {
                return Err(AppError::AppPath(
                    "A worktree branch cannot be supplied without a worktree path".to_string(),
                ));
            }
            (None, None)
        }
    };

    let token = uuid::Uuid::new_v4().to_string();
    state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .insert(
            token.clone(),
            ProjectRunCapability {
                conversation_id: conversation_id.to_string(),
                project_id: project_id.to_string(),
                worktree_path: canonical_worktree,
                branch: verified_branch,
                workspace_baseline: None,
                read_only: false,
            },
        );
    Ok(token)
}

fn register_project_browser(
    state: &ProjectRegistry,
    project_id: &str,
    conversation_id: &str,
    worktree_path: Option<&str>,
    branch: Option<&str>,
) -> Result<String, AppError> {
    let project = state
        .projects
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .get(project_id)
        .cloned()
        .ok_or_else(|| {
            AppError::AppPath("Access denied: Project not found in registry".to_string())
        })?;

    let (canonical_worktree, verified_branch) = match worktree_path {
        Some(path) => {
            let verified = validate_owned_worktree(&project, path, branch)?;
            (Some(verified.path), Some(verified.branch))
        }
        None => {
            if branch.is_some() {
                return Err(AppError::AppPath(
                    "A worktree branch cannot be supplied without a worktree path".to_string(),
                ));
            }
            (None, None)
        }
    };

    let token = uuid::Uuid::new_v4().to_string();
    state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .insert(
            token.clone(),
            ProjectRunCapability {
                conversation_id: conversation_id.to_string(),
                project_id: project_id.to_string(),
                worktree_path: canonical_worktree,
                branch: verified_branch,
                workspace_baseline: None,
                read_only: true,
            },
        );
    Ok(token)
}

pub(crate) fn validate_project_run_access(
    state: &ProjectRegistry,
    run_token: &str,
    project_id: &str,
    requested_worktree: Option<&str>,
    write_required: bool,
) -> Result<Option<PathBuf>, AppError> {
    let capability = get_project_run_capability(state, run_token)?;
    if write_required && capability.read_only {
        return Err(AppError::AppPath(
            "Access denied: Project browser capability is read-only".to_string(),
        ));
    }
    validate_project_run_capability(state, &capability, project_id, requested_worktree)
}

#[cfg(test)]
pub(crate) fn validate_project_run(
    state: &ProjectRegistry,
    run_token: &str,
    project_id: &str,
    requested_worktree: Option<&str>,
) -> Result<Option<PathBuf>, AppError> {
    let capability = get_project_run_capability(state, run_token)?;
    validate_project_run_capability(state, &capability, project_id, requested_worktree)
}

fn get_project_run_capability(
    state: &ProjectRegistry,
    run_token: &str,
) -> Result<ProjectRunCapability, AppError> {
    state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
        .get(run_token)
        .cloned()
        .ok_or_else(|| {
            AppError::AppPath(
                "Access denied: Project run capability is invalid or expired".to_string(),
            )
        })
}

pub(crate) fn set_project_run_workspace_baseline(
    state: &ProjectRegistry,
    run_token: &str,
    project_id: &str,
    baseline: String,
) -> Result<(), AppError> {
    let mut capabilities = state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let capability = capabilities.get_mut(run_token).ok_or_else(|| {
        AppError::AppPath("Access denied: Project run capability is invalid or expired".to_string())
    })?;
    if capability.project_id != project_id || capability.worktree_path.is_some() {
        return Err(AppError::AppPath(
            "Access denied: Workspace snapshot does not belong to this direct project run"
                .to_string(),
        ));
    }
    capability.workspace_baseline = Some(baseline);
    Ok(())
}

pub(crate) fn project_run_workspace_baseline(
    state: &ProjectRegistry,
    run_token: &str,
    project_id: &str,
) -> Result<Option<String>, AppError> {
    let capability = get_project_run_capability(state, run_token)?;
    if capability.project_id != project_id || capability.worktree_path.is_some() {
        return Err(AppError::AppPath(
            "Access denied: Workspace snapshot does not belong to this direct project run"
                .to_string(),
        ));
    }
    Ok(capability.workspace_baseline)
}

pub(crate) fn clear_project_run_workspace_baseline(
    state: &ProjectRegistry,
    run_token: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let mut capabilities = state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let capability = capabilities.get_mut(run_token).ok_or_else(|| {
        AppError::AppPath("Access denied: Project run capability is invalid or expired".to_string())
    })?;
    if capability.project_id != project_id || capability.worktree_path.is_some() {
        return Err(AppError::AppPath(
            "Access denied: Workspace snapshot does not belong to this direct project run"
                .to_string(),
        ));
    }
    capability.workspace_baseline = None;
    Ok(())
}

fn validate_project_run_capability(
    state: &ProjectRegistry,
    capability: &ProjectRunCapability,
    project_id: &str,
    requested_worktree: Option<&str>,
) -> Result<Option<PathBuf>, AppError> {
    if capability.project_id != project_id {
        return Err(AppError::AppPath(
            "Access denied: Project run capability belongs to another project".to_string(),
        ));
    }

    match (&capability.worktree_path, requested_worktree) {
        (Some(expected), Some(requested)) => {
            let requested = Path::new(requested)
                .canonicalize()
                .map_err(|e| AppError::AppPath(format!("Invalid worktree path: {e}")))?;
            if &requested != expected {
                return Err(AppError::AppPath(
                    "Access denied: Worktree does not belong to this project run".to_string(),
                ));
            }
            let project = state
                .projects
                .lock()
                .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?
                .get(project_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::AppPath("Access denied: Project not found in registry".to_string())
                })?;
            let branch = capability.branch.as_deref().ok_or_else(|| {
                AppError::AppPath("Access denied: Project run worktree has no branch".to_string())
            })?;
            Ok(Some(
                validate_owned_worktree(&project, &expected.to_string_lossy(), Some(branch))?.path,
            ))
        }
        (None, None) => Ok(None),
        _ => Err(AppError::AppPath(
            "Access denied: Every project command must use the run's bound workspace root"
                .to_string(),
        )),
    }
}

#[tauri::command]
pub(crate) fn project_run_begin(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    conversation_id: String,
    worktree_path: Option<String>,
    branch: Option<String>,
) -> Result<String, AppError> {
    register_project_run(
        &state,
        &project_id,
        &conversation_id,
        worktree_path.as_deref(),
        branch.as_deref(),
    )
}

#[tauri::command]
pub(crate) fn project_browse_begin(
    state: tauri::State<'_, ProjectRegistry>,
    project_id: String,
    conversation_id: String,
    worktree_path: Option<String>,
    branch: Option<String>,
) -> Result<String, AppError> {
    register_project_browser(
        &state,
        &project_id,
        &conversation_id,
        worktree_path.as_deref(),
        branch.as_deref(),
    )
}

#[tauri::command]
pub(crate) fn project_run_end(
    state: tauri::State<'_, ProjectRegistry>,
    run_token: String,
    conversation_id: String,
) -> Result<(), AppError> {
    let mut capabilities = state
        .run_capabilities
        .lock()
        .map_err(|_| AppError::AppPath("Poisoned lock".to_string()))?;
    let capability = capabilities.get(&run_token).ok_or_else(|| {
        AppError::AppPath("Access denied: Project run capability is invalid or expired".to_string())
    })?;
    if capability.conversation_id != conversation_id {
        return Err(AppError::AppPath(
            "Access denied: Project run capability belongs to another conversation".to_string(),
        ));
    }
    capabilities.remove(&run_token);
    Ok(())
}

/// Helper function to validate if a path is within the project root and is allowed
pub(crate) fn validate_project_path(
    project: &Project,
    relative_path: &str,
    required_permission: &str,
) -> Result<PathBuf, AppError> {
    // Check permission tier
    // required_permission can be "read" or "write"
    match required_permission {
        "write" => {
            if project.permissions == ProjectPermission::Read {
                return Err(AppError::AppPath(
                    "Permission denied: write access not allowed".to_string(),
                ));
            }
        }
        "full" if project.permissions != ProjectPermission::Full => {
            return Err(AppError::AppPath(
                "Permission denied: full shell access not allowed".to_string(),
            ));
        }
        _ => {} // read requires no check, since all projects have at least read permissions
    }

    let root = Path::new(&project.path);
    let root_canonical = root
        .canonicalize()
        .map_err(|e| AppError::AppPath(format!("Failed to canonicalize project root: {}", e)))?;

    let user_path = Path::new(relative_path);
    if user_path.is_absolute() {
        return Err(AppError::AppPath(format!(
            "Absolute paths are not allowed. Use a path relative to the workspace root '{}' instead (for example 'src/main.rs').",
            root.display()
        )));
    }
    let full_path = root_canonical.join(user_path);

    // Clean traversal
    let mut clean_path = PathBuf::new();
    for component in full_path.components() {
        match component {
            std::path::Component::ParentDir => {
                if !clean_path.pop() {
                    return Err(AppError::AppPath("Path traversal detected".to_string()));
                }
            }
            std::path::Component::CurDir => {}
            _ => {
                clean_path.push(component.as_os_str());
            }
        }
    }

    let resolved = if clean_path.exists() {
        clean_path.canonicalize().map_err(|e| {
            AppError::AppPath(format!("Failed to canonicalize resolved path: {}", e))
        })?
    } else {
        // Collect the not-yet-existing components from deepest to shallowest so
        // they can be re-joined onto the closest existing ancestor. Pushing an
        // empty PathBuf into the suffix would append a trailing separator, which
        // made fs::write fail with ENOENT for every brand-new file.
        let mut ancestor = clean_path.as_path();
        let mut missing_components = Vec::new();
        while let Some(parent) = ancestor.parent() {
            if ancestor.exists() {
                break;
            }
            if let Some(name) = ancestor.file_name() {
                missing_components.push(name.to_os_string());
            }
            ancestor = parent;
        }
        if ancestor.exists() {
            let canon_ancestor = ancestor.canonicalize().map_err(|e| {
                AppError::AppPath(format!("Failed to canonicalize ancestor: {}", e))
            })?;
            let mut resolved = canon_ancestor;
            for name in missing_components.into_iter().rev() {
                resolved.push(name);
            }
            resolved
        } else {
            clean_path.clone()
        }
    };

    if !resolved.starts_with(&root_canonical) {
        return Err(AppError::AppPath(format!(
            "Access denied: path '{}' is outside workspace '{}'",
            resolved.display(),
            root_canonical.display()
        )));
    }

    let exclusions = ProjectExclusions::new(project, &root_canonical)?;
    exclusions.ensure_allowed(&clean_path, clean_path.is_dir())?;
    exclusions.ensure_allowed(&resolved, resolved.is_dir())?;

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::{
        is_sythoria_agent_branch, parse_git_worktrees, register_project_run,
        sythoria_worktree_root, validate_owned_worktree, validate_project_path,
        validate_project_run, validate_project_run_access, Project, ProjectExclusions,
        ProjectPermission, ProjectRegistry,
    };
    use super::AppError;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn test_project(path: PathBuf) -> Project {
        Project {
            id: "project".to_string(),
            name: "Project".to_string(),
            path: path.to_string_lossy().into_owned(),
            permissions: ProjectPermission::Full,
            skip_command_confirmations: None,
            exclude_patterns: None,
            system_prompt_override: None,
            model_override: None,
            is_auto_commit_enabled: None,
            auto_commit_msg_template: None,
        }
    }

    #[test]
    fn project_optional_settings_survive_json_round_trip() {
        let mut project = test_project(PathBuf::from("C:/workspace"));
        project.system_prompt_override = Some("Be concise".to_string());
        project.model_override = Some("model-x".to_string());
        project.skip_command_confirmations = Some(true);
        project.is_auto_commit_enabled = Some(true);
        project.auto_commit_msg_template = Some("feat: {summary}".to_string());

        let json = serde_json::to_string(&project).expect("serialize project");
        let decoded: Project = serde_json::from_str(&json).expect("deserialize project");

        assert_eq!(
            decoded.system_prompt_override,
            project.system_prompt_override
        );
        assert_eq!(decoded.model_override, project.model_override);
        assert_eq!(decoded.skip_command_confirmations, Some(true));
        assert_eq!(decoded.is_auto_commit_enabled, Some(true));
        assert_eq!(
            decoded.auto_commit_msg_template,
            project.auto_commit_msg_template
        );
        assert!(json.contains("systemPromptOverride"));
        assert!(json.contains("skipCommandConfirmations"));
        assert!(json.contains("isAutoCommitEnabled"));
    }

    #[test]
    fn project_permissions_reject_unknown_values() {
        let json = r#"{
            "id":"project",
            "name":"Project",
            "path":"C:/workspace",
            "permissions":"owner"
        }"#;

        assert!(serde_json::from_str::<Project>(json).is_err());
    }

    #[test]
    fn parses_nul_delimited_git_worktree_metadata() {
        let entries = parse_git_worktrees(
            b"worktree C:/repo\0HEAD abc\0branch refs/heads/main\0\0worktree C:/tmp/wt\0HEAD def\0branch refs/heads/sythoria-agent-a1b2c3d4\0\0",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].branch, "sythoria-agent-a1b2c3d4");
    }

    #[test]
    fn agent_branch_names_are_strictly_scoped() {
        assert!(is_sythoria_agent_branch("sythoria-agent-a1b2c3d4"));
        assert!(!is_sythoria_agent_branch("main"));
        assert!(!is_sythoria_agent_branch("sythoria-agent-too-long"));
        assert!(!is_sythoria_agent_branch("sythoria-agent-../../x"));
    }

    #[test]
    fn arbitrary_existing_directory_cannot_be_used_as_worktree() {
        let current = std::env::current_dir().expect("current directory");
        let project = test_project(current.clone());
        assert!(validate_owned_worktree(&project, &current.to_string_lossy(), None).is_err());
    }

    #[test]
    fn write_capability_can_bind_directly_to_the_registered_project() {
        let current = std::env::current_dir().expect("current directory");
        let registry = ProjectRegistry::new();
        registry
            .projects
            .lock()
            .expect("lock registry")
            .insert("project".to_string(), test_project(current));

        let token = register_project_run(&registry, "project", "conversation", None, None)
            .expect("register direct project run");
        assert_eq!(
            validate_project_run_access(&registry, &token, "project", None, true)
                .expect("validate direct write access"),
            None
        );
    }

    #[test]
    fn root_relative_exclusions_match_nested_files_and_directories() {
        let root =
            std::env::temp_dir().join(format!("sythoria-exclusions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/node_modules/pkg")).expect("create node_modules");
        std::fs::create_dir_all(root.join("nested/.git")).expect("create nested git directory");
        std::fs::write(root.join("src/node_modules/pkg/index.js"), "secret")
            .expect("write dependency file");
        std::fs::write(root.join("nested/.git/config"), "secret").expect("write git config");
        std::fs::write(root.join("nested/.env"), "TOKEN=secret").expect("write env file");
        std::fs::write(root.join("visible.txt"), "visible").expect("write visible file");

        let mut project = test_project(root.clone());
        project.permissions = ProjectPermission::Read;
        project.exclude_patterns = Some(vec!["node_modules".into(), ".git".into(), ".env".into()]);

        assert!(validate_project_path(&project, "src/node_modules/pkg/index.js", "read").is_err());
        assert!(validate_project_path(&project, "nested/.git/config", "read").is_err());
        assert!(validate_project_path(&project, "nested/.env", "read").is_err());
        assert!(validate_project_path(&project, "visible.txt", "read").is_ok());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn new_files_resolve_to_writable_paths_without_trailing_separators() {
        let root = std::env::temp_dir().join(format!("sythoria-write-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test root");
        std::fs::write(root.join("existing.txt"), "old content").expect("write existing file");

        let mut project = test_project(root.clone());
        project.permissions = ProjectPermission::Write;

        // Regression: creating a brand-new file used to resolve with a trailing
        // separator, which made fs::write fail with ENOENT (os error 2).
        let new_at_root = validate_project_path(&project, "cap_bypass_poc.py", "write")
            .expect("new file at workspace root");
        assert!(
            !new_at_root.to_string_lossy().ends_with('/'),
            "resolved path must not end with a separator: {}",
            new_at_root.display()
        );
        std::fs::write(&new_at_root, "poc").expect("write new file at workspace root");

        let nested = validate_project_path(&project, "poc/sub/new.py", "write")
            .expect("nested new file");
        assert!(!nested.to_string_lossy().ends_with('/'));
        std::fs::create_dir_all(nested.parent().expect("nested parent directory"))
            .expect("create missing parent directories");
        std::fs::write(&nested, "nested").expect("write nested new file");

        let overwritten =
            validate_project_path(&project, "existing.txt", "write").expect("existing file");
        std::fs::write(&overwritten, "new content").expect("overwrite existing file");

        assert!(absolute_paths_are_rejected_with_guidance(&project));

        assert_eq!(
            std::fs::read_to_string(root.join("cap_bypass_poc.py")).expect("root file"),
            "poc"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("poc/sub/new.py")).expect("nested file"),
            "nested"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("existing.txt")).expect("overwritten file"),
            "new content"
        );

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    fn absolute_paths_are_rejected_with_guidance(project: &Project) -> bool {
        matches!(
            validate_project_path(project, "/tmp/cap_bypass_poc.py", "write"),
            Err(AppError::AppPath(message)) if message.contains("Absolute paths are not allowed") && message.contains("relative to the workspace root")
        )
    }

    #[cfg(unix)]
    #[test]
    fn symlink_aliases_to_excluded_paths_are_rejected() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("sythoria-symlink-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("private")).expect("create private directory");
        std::fs::write(root.join("private/secret.txt"), "secret").expect("write secret");
        symlink(root.join("private"), root.join("alias")).expect("create symlink");

        let mut project = test_project(root.clone());
        project.permissions = ProjectPermission::Read;
        project.exclude_patterns = Some(vec!["private".into()]);

        assert!(validate_project_path(&project, "alias/secret.txt", "read").is_err());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn exclusion_matcher_rejects_reinclusion_patterns() {
        let root = std::env::temp_dir().join(format!("sythoria-pattern-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test root");
        let mut project = test_project(root.clone());
        project.exclude_patterns = Some(vec!["!secret.txt".into()]);

        assert!(ProjectExclusions::new(&project, &root).is_err());

        std::fs::remove_dir_all(&root).expect("remove test root");
    }

    fn run_git(repo: &PathBuf, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn concurrent_project_runs_keep_writes_in_their_own_worktrees() {
        let unique = uuid::Uuid::new_v4().simple().to_string();
        let fixture_root = std::env::temp_dir().join("sythoria-tests").join(&unique);
        let repo = fixture_root.join("repo");
        let owned_root = sythoria_worktree_root().join(&unique);
        let worktree_one = owned_root.join("run-one");
        let worktree_two = owned_root.join("run-two");
        fs::create_dir_all(&repo).expect("create repository fixture");
        fs::create_dir_all(&owned_root).expect("create owned worktree fixture");

        run_git(&repo, &["init"]);
        run_git(&repo, &["config", "user.name", "Sythoria Test"]);
        run_git(&repo, &["config", "user.email", "test@sythoria.local"]);
        run_git(&repo, &["config", "commit.gpgsign", "false"]);
        fs::write(repo.join("shared.txt"), "base").expect("write fixture file");
        run_git(&repo, &["add", "shared.txt"]);
        run_git(&repo, &["commit", "-m", "fixture"]);

        let branch_one = format!("sythoria-agent-{}", &unique[0..8]);
        let branch_two = format!("sythoria-agent-{}", &unique[8..16]);
        let worktree_one_arg = worktree_one.to_string_lossy().into_owned();
        let worktree_two_arg = worktree_two.to_string_lossy().into_owned();
        run_git(
            &repo,
            &["worktree", "add", "-b", &branch_one, &worktree_one_arg],
        );
        run_git(
            &repo,
            &["worktree", "add", "-b", &branch_two, &worktree_two_arg],
        );

        let registry = Arc::new(ProjectRegistry::new());
        registry
            .projects
            .lock()
            .expect("lock registry")
            .insert("project".to_string(), test_project(repo.clone()));
        let token_one = register_project_run(
            &registry,
            "project",
            "conversation-one",
            Some(&worktree_one_arg),
            Some(&branch_one),
        )
        .expect("register first run");
        let token_two = register_project_run(
            &registry,
            "project",
            "conversation-two",
            Some(&worktree_two_arg),
            Some(&branch_two),
        )
        .expect("register second run");

        assert_eq!(
            validate_project_run_access(
                &registry,
                &token_one,
                "project",
                Some(&worktree_one_arg),
                true,
            )
            .expect("validate write access"),
            Some(
                worktree_one
                    .canonicalize()
                    .expect("canonical first worktree")
            )
        );

        assert!(
            validate_project_run(&registry, &token_one, "project", Some(&worktree_two_arg))
                .is_err()
        );
        assert!(
            validate_project_run(&registry, &token_two, "project", Some(&worktree_one_arg))
                .is_err()
        );

        let barrier = Arc::new(Barrier::new(2));
        let handles = [
            (
                Arc::clone(&registry),
                Arc::clone(&barrier),
                token_one,
                worktree_one_arg.clone(),
                "conversation one",
            ),
            (
                Arc::clone(&registry),
                Arc::clone(&barrier),
                token_two,
                worktree_two_arg.clone(),
                "conversation two",
            ),
        ]
        .into_iter()
        .map(|(registry, barrier, token, worktree, content)| {
            thread::spawn(move || {
                barrier.wait();
                let root = validate_project_run(&registry, &token, "project", Some(&worktree))
                    .expect("validate run")
                    .expect("run has worktree");
                fs::write(root.join("shared.txt"), content).expect("write isolated file");
            })
        })
        .collect::<Vec<_>>();
        for handle in handles {
            handle.join().expect("project run thread");
        }

        assert_eq!(
            fs::read_to_string(worktree_one.join("shared.txt")).expect("read first worktree"),
            "conversation one"
        );
        assert_eq!(
            fs::read_to_string(worktree_two.join("shared.txt")).expect("read second worktree"),
            "conversation two"
        );
        assert_eq!(
            fs::read_to_string(repo.join("shared.txt")).expect("read base repository"),
            "base"
        );

        run_git(&repo, &["worktree", "remove", "--force", &worktree_one_arg]);
        run_git(&repo, &["worktree", "remove", "--force", &worktree_two_arg]);
        fs::remove_dir_all(&fixture_root).expect("remove repository fixture");
        fs::remove_dir_all(&owned_root).expect("remove worktree fixture");
    }
}
