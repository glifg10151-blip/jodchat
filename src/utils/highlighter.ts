import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";

type LowlightInstance = ReturnType<typeof createLowlight>;
type LanguageModule = { default?: LanguageFn } | LanguageFn;
type HastNode =
  | { type: "text"; value: string }
  | { type: "root"; children?: HastNode[] }
  | {
      type: "element";
      tagName?: string;
      properties?: {
        className?: string | string[];
      };
      children?: HastNode[];
    };

let lowlightInstance: LowlightInstance | null = null;

const LANG_MODULES: Record<string, () => Promise<LanguageModule>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  css: () => import("highlight.js/lib/languages/css"),
  xml: () => import("highlight.js/lib/languages/xml"),
  json: () => import("highlight.js/lib/languages/json"),
  bash: () => import("highlight.js/lib/languages/bash"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  sql: () => import("highlight.js/lib/languages/sql"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  jsx: () => import("highlight.js/lib/languages/javascript"),
  tsx: () => import("highlight.js/lib/languages/typescript"),
  diff: () => import("highlight.js/lib/languages/diff"),
  toml: () => import("highlight.js/lib/languages/ini"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  php: () => import("highlight.js/lib/languages/php"),
  swift: () => import("highlight.js/lib/languages/swift"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  scala: () => import("highlight.js/lib/languages/scala"),
  lua: () => import("highlight.js/lib/languages/lua"),
  perl: () => import("highlight.js/lib/languages/perl"),
  r: () => import("highlight.js/lib/languages/r"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  svelte: () => import("highlight.js/lib/languages/xml"),
  html: () => import("highlight.js/lib/languages/xml"),
  shell: () => import("highlight.js/lib/languages/bash"),
  plaintext: () => import("highlight.js/lib/languages/plaintext"),
  dart: () => import("highlight.js/lib/languages/dart"),
  x86asm: () => import("highlight.js/lib/languages/x86asm"),
  armasm: () => import("highlight.js/lib/languages/armasm"),
};

const ALIAS_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  cxx: "cpp",
  yml: "yaml",
  md: "markdown",
  docker: "dockerfile",
  kt: "kotlin",
  shellscript: "bash",
  html: "xml",
  cs: "csharp",
  "c#": "csharp",
  asm: "x86asm",
  arm: "armasm",
};

function getLowlight(): LowlightInstance {
  if (lowlightInstance) return lowlightInstance;
  lowlightInstance = createLowlight();
  return lowlightInstance;
}

async function loadLanguage(lang: string): Promise<boolean> {
  const importer = LANG_MODULES[lang];
  if (!importer) return false;

  try {
    const mod = await importer();
    const langFn = typeof mod === "function" ? mod : mod.default;
    if (typeof langFn !== "function") return false;
    getLowlight().register({ [lang]: langFn });
    return true;
  } catch {
    return false;
  }
}

import DOMPurify from "dompurify";

export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const resolvedLang = ALIAS_MAP[lang.toLowerCase()] || lang.toLowerCase();
  const lowlight = getLowlight();

  if (!lowlight.registered(resolvedLang)) {
    const loaded = await loadLanguage(resolvedLang);
    if (!loaded) return null;
  }

  try {
    const tree = lowlight.highlight(resolvedLang, code);
    const html = serializeHast(tree as HastNode);
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["span", "pre", "code", "br"],
      ALLOWED_ATTR: ["class"],
    });
  } catch {
    return null;
  }
}

function serializeHast(tree: HastNode): string {
  if (tree.type === "text") return escapeHtml(tree.value);
  if (tree.type === "root") return (tree.children || []).map(serializeHast).join("");
  if (tree.type === "element") {
    const tag = tree.tagName || "span";
    const props = tree.properties || {};
    const classStr = props.className
      ? ` class="${(Array.isArray(props.className) ? props.className : [props.className]).join(" ")}"`
      : "";
    const children = (tree.children || []).map(serializeHast).join("");
    return `<${tag}${classStr}>${children}</${tag}>`;
  }
  return "";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
