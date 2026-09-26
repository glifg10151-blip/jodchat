export { parseGitDiff, type DiffFile } from "../utils/gitDiff";

export function joinProjectPath(parent: string, child: string): string {
  return parent ? `${parent.replace(/\/$/, "")}/${child.replace(/^\//, "")}` : child.replace(/^\//, "");
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function languageFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    css: "CSS",
    html: "HTML",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    md: "Markdown",
    py: "Python",
    rs: "Rust",
    toml: "TOML",
    ts: "TypeScript",
    tsx: "TSX",
    yaml: "YAML",
    yml: "YAML",
  };
  return extension ? languages[extension] || extension.toUpperCase() : "Text";
}
