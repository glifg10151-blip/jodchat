/** Resolve Markdown file links inside the conversation's registered project only. */
export function resolveProjectFileLink(href: string, projectRoot: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (
    !path ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    path.startsWith("#") ||
    path.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  )
    return null;
  path = path.replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/, "");
  const root = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  path = path.replace(/\\/g, "/");
  if (path.startsWith("/")) {
    if (!path.startsWith(`${root}/`)) return null;
    path = path.slice(root.length + 1);
  }
  const parts = path.split("/").filter((part) => part !== "." && part !== "");
  if (!parts.length || parts.includes("..") || path.endsWith("/") || /[?#]/.test(path)) return null;
  return parts.join("/");
}
