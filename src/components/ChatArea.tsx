import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
  useCallback,
  useMemo,
  useDeferredValue,
  useId,
  isValidElement,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { resolveProjectFileLink } from "../utils/projectFileLinks";
import { normalizeExternalUrl, openExternalUrl } from "../utils/externalUrl";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useTranslation } from "../utils/i18n";
import remarkGfm from "remark-gfm";
import { remarkCitations } from "../utils/remarkCitations";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Copy,
  Check,
  Search,
  Globe,
  Wrench,
  ChevronRight,
  Loader2,
  ExternalLink,
  Sparkles,
  RotateCw,
  Terminal,
  FileText as FileTextIcon,
  Image as ImageIcon,
  FileCode,
  FilePenLine,
  Files,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  GitCommitHorizontal,
  Save,
  Eye,
  Ghost,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Undo2,
  Users,
  Cpu,
  BookOpen,
  PackageOpen,
} from "lucide-react";
import { QuestionCard } from "./ui/QuestionCard";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { isGenerationActive, type Message, type Attachment, type WorkspaceChangeSet } from "../types";
import { highlightCode } from "../utils/highlighter";
import { motionTokens, motionTransitions, springs } from "../lib/motion-tokens";
import { formatFileSize } from "../utils/attachments";
import { parseReasoning } from "../utils/messageParser";
import { ImagePreviewModal } from "./ui/ImagePreviewModal";
import { FileEditDiffCard } from "./FileEditDiffCard";
import { WEB_SEARCH_MENTION } from "../utils/toolMentions";
import { elapsedSeconds, formatElapsedDuration } from "../utils/duration";

const messageVariants = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: { opacity: 1, y: 0 },
};

interface ChatAreaProps {
  messages: Message[];
  setIsAtBottom?: (v: boolean) => void;
  virtuosoRef?: React.RefObject<VirtuosoHandle | null>;
  onRetry?: (messageId: string) => void;
  onScroll?: (scrollTop: number, ratio: number) => void;
  conversationId?: string;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  autoExpandReasoning?: boolean;
  showEmptyState?: boolean;
}

function SyntaxCodeBlock({ code, language, maxHeight }: { code: string; language: string; maxHeight?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, language).then((html) => {
      if (!cancelled && html) {
        setHighlighted(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    try {
      const text = ref.current?.textContent || code;
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [code]);

  const isPreviewable = language === "html" || language === "svg" || language === "mermaid";
  const setActiveArtifact = useUIStore((s) => s.setActiveArtifact);
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  const handlePreview = useCallback(() => {
    setActiveArtifact({
      title: `${language.toUpperCase()} Preview`,
      content: code,
      type: language as "html" | "svg" | "mermaid",
    });
  }, [code, language, setActiveArtifact]);

  return (
    <div className="code-block group relative bg-surface border border-border rounded-xl overflow-hidden shadow-sm my-3">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-text-muted border-b border-border/40 select-none">
        <span className="flex items-center gap-1.5 font-mono lowercase">
          <Terminal size={12} />
          {language}
        </span>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {isProjectsEnabled && isPreviewable && (
            <motion.button
              onClick={handlePreview}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
              aria-label="Preview content"
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
            >
              <Eye size={12} />
              <span>Preview</span>
            </motion.button>
          )}
          <motion.button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
            aria-label={copied ? "Copied" : "Copy code"}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </motion.button>
        </div>
      </div>
      {highlighted ? (
        <div
          ref={ref}
          className="code-block-content"
          style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <div ref={ref} className="code-block-content" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
          <code className={`language-${language}`}>{code}</code>
        </div>
      )}
    </div>
  );
}

function ShellTranscript({ command, output }: { command: string; output?: string }) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-border/60 bg-surface/80 shadow-sm"
      aria-label="Shell command output"
    >
      <div className="border-b border-border/40 px-4 py-2 text-sm font-medium text-text-secondary">Shell</div>
      <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm leading-relaxed text-text-secondary">
        <code>
          <span className="select-none text-text-muted" aria-hidden="true">
            ${" "}
          </span>
          <span>{command}</span>
          {output ? <>{`\n${output}`}</> : null}
        </code>
      </pre>
    </section>
  );
}

async function openSafeUrl(href: string): Promise<void> {
  await openExternalUrl(href, { confirmInsecure: true });
}

const markdownComponents = {
  pre({ children }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
    // Return Fragment to avoid nesting <pre> inside .markdown-body pre (double border bug)
    return <>{children}</>;
  },
  code({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "text";
      const codeStr = extractText(children);
      return <SyntaxCodeBlock code={codeStr} language={language} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
    const safeHref = href ? normalizeExternalUrl(href)?.href : undefined;
    const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (safeHref) {
        const { skipExternalLinkWarning, setShowLinkWarningModal } = useUIStore.getState();
        if (skipExternalLinkWarning) {
          openSafeUrl(safeHref);
        } else {
          setShowLinkWarningModal(true, safeHref);
        }
      }
    };
    return (
      <a href={safeHref} onClick={handleLinkClick} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (isValidElement<{ children?: React.ReactNode }>(children)) {
    return extractText(children.props.children);
  }
  return "";
}

const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  conversationId,
  sources,
}: {
  content: string;
  conversationId?: string;
  sources?: Message["sources"];
}) {
  const projectId = useChatStore(
    (state) => state.conversations.find((conversation) => conversation.id === conversationId)?.projectId,
  );
  const projectRoot = useProjectStore((state) => state.projects.find((project) => project.id === projectId)?.path);
  const components = {
    ...markdownComponents,
    a({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
      const path = projectRoot && href ? resolveProjectFileLink(href, projectRoot) : null;
      if (path && conversationId) {
        return (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 text-accent underline decoration-accent/40 underline-offset-2 hover:bg-accent/20 focus-visible:outline focus-visible:outline-2"
            title={`Open ${path} in review`}
            onClick={() => openWorkspaceReview(conversationId, path)}
          >
            <FileCode size={13} aria-hidden="true" />
            {children}
          </button>
        );
      }
      if (props.className === "citation-tag") {
        return markdownComponents.a({
          ...props,
          href,
          children: (
            <>
              <Globe size={13} aria-hidden="true" />
              <span>{children}</span>
            </>
          ),
        });
      }
      return markdownComponents.a({ href, children, ...props });
    },
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, [remarkCitations, sources]]}
      rehypePlugins={[rehypeKatex]}
      components={components}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
});

function MessageContent({
  content,
  isStreaming,
  conversationId,
  role,
  sources,
}: {
  content: string;
  isStreaming: boolean;
  conversationId?: string;
  role?: string;
  sources?: Message["sources"];
}) {
  const deferredContent = useDeferredValue(content);
  const renderContent = isStreaming ? deferredContent : content;

  return (
    <>
      <StreamingMarkdown
        content={renderContent}
        conversationId={role === "assistant" ? conversationId : undefined}
        sources={role === "assistant" ? sources : undefined}
      />
      {isStreaming && <span className="cursor-blink" aria-label="Generating response" />}
    </>
  );
}

const TOOL_LABEL_PATTERN = /\[MCP:\s*([^\]\r\n]+?)\]|\[Web Search\]/g;

function UserMessageContent({ message }: { message: Message }) {
  const { t } = useTranslation();
  const { content } = message;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let remainingMcpMentions = message.mcpServerIds?.length ?? 0;

  for (const match of content.matchAll(TOOL_LABEL_PATTERN)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) parts.push(content.slice(cursor, matchIndex));

    const isWebSearch = match[0] === WEB_SEARCH_MENTION;
    const isAuthorizedMention = isWebSearch ? Boolean(message.searchConfigId) : remainingMcpMentions > 0;
    if (!isAuthorizedMention) {
      parts.push(match[0]);
      cursor = matchIndex + match[0].length;
      continue;
    }
    if (!isWebSearch) remainingMcpMentions -= 1;
    const label = isWebSearch ? t("chat.webSearch") || "Web Search" : match[1].trim();
    parts.push(
      <span
        key={`${matchIndex}-${label}`}
        role="img"
        aria-label={isWebSearch ? `${label} tool` : `MCP tool: ${label}`}
        className="inline-reference inline-text-reference max-w-[14rem]"
      >
        {isWebSearch ? (
          <Search size={13} className="shrink-0" aria-hidden="true" />
        ) : (
          <Cpu size={13} className="shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{label}</span>
      </span>,
    );
    cursor = matchIndex + match[0].length;
  }

  if (cursor < content.length) parts.push(content.slice(cursor));
  return <>{parts.length > 0 ? parts : content}</>;
}

function ActionButton({
  icon,
  label,
  activeIcon,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  activeIcon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors flex items-center justify-center ${
        active ? "text-text-primary" : ""
      }`}
      aria-label={label}
      title={label}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.snappy}
    >
      {active && activeIcon ? activeIcon : icon}
    </motion.button>
  );
}

function MessageActions({
  content,
  sources,
  isUser,
  onSourceClick,
  onRetry,
}: {
  content: string;
  sources?: { title: string; url: string }[];
  isUser: boolean;
  onSourceClick?: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [content]);

  return (
    <div className="flex items-center gap-0.5 mt-1 -ml-1">
      <ActionButton
        icon={<Copy size={14} />}
        activeIcon={<Check size={14} className="text-emerald-500" />}
        active={copied}
        label={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
      />
      {!isUser && <ActionButton icon={<RotateCw size={14} />} label="Regenerate" onClick={onRetry} />}
      {sources && sources.length > 0 && (
        <>
          <span className="w-px h-3.5 bg-border/50 mx-1" />
          <motion.button
            onClick={onSourceClick}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title={`${sources.length} source${sources.length !== 1 ? "s" : ""}`}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            <Globe size={12} />
            <span>
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
          </motion.button>
        </>
      )}
    </div>
  );
}

function SourcesList({ sources }: { sources: { title: string; url: string }[] }) {
  return (
    <motion.div
      className="mt-1.5 p-2 rounded-lg bg-surface border border-border"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={motionTransitions.content}
    >
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <motion.a
            key={i}
            href={normalizeExternalUrl(s.url)?.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl(s.url, { confirmInsecure: true });
            }}
            className="inline-reference py-1 text-[11px] max-w-[200px] hover:underline focus-visible:ring-2 focus-visible:ring-accent/50"
            title={s.title || s.url}
            whileHover={{ scale: motionTokens.scale.pop }}
            transition={springs.snappy}
          >
            <ExternalLink size={10} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{s.title || s.url}</span>
          </motion.a>
        ))}
      </div>
    </motion.div>
  );
}

function formatToolName(name: string): string {
  if (name.includes("__")) {
    const parts = name.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : name;
  }
  if (name.startsWith("project_")) {
    const raw = name.replace("project_", "");
    return raw
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return name;
}

function getShellCommand(name: string, args: Record<string, string> | undefined): string {
  if (name === "project_git_status") return "git status";
  if (name === "project_git_diff") return "git diff";
  if (name === "project_git_commit") return "git commit";
  return args?.command || formatToolName(name);
}

function getNativeToolDisplayInfo(
  name: string,
  args: Record<string, string> | undefined,
  result: Message["toolResult"] | undefined,
  isCompleted: boolean,
  t: (key: string, replacements?: Record<string, string>) => string,
) {
  if (!args) return null;

  if (name === "wait_subagents") {
    return {
      type: "subagent",
      filename: "",
      IconComponent: Users,
      colorClass: "text-text-muted",
      label: isCompleted ? "Subagents Finished" : "Waiting for Subagents",
    };
  }
  if (name === "invoke_subagent") {
    return null;
  }

  if (name === "read_skill" || name === "list_skill_resources" || name === "read_skill_resource") {
    const skillId = args.id || "skill";
    const isResource = name === "read_skill_resource";
    const isResourceList = name === "list_skill_resources";
    return {
      type: "skill",
      skillId,
      resourcePath: isResource ? args.path : undefined,
      IconComponent: isResourceList ? PackageOpen : BookOpen,
      colorClass: "text-red-600 dark:text-red-400",
      label: isResourceList
        ? isCompleted
          ? t("chat.tools.listedSkillResources")
          : t("chat.tools.listingSkillResources")
        : isResource
          ? isCompleted
            ? t("chat.tools.readSkillResource")
            : t("chat.tools.readingSkillResource")
          : isCompleted
            ? t("chat.tools.readSkill")
            : t("chat.tools.readingSkill"),
    };
  }

  const isNativeProjectTool = name.startsWith("project_") && !name.includes("__");
  const isMcpFileChange = name.includes("__") && !!result?.diffSummary?.filename && !!result.diffSummary.hunks?.length;
  if (!isNativeProjectTool && !isMcpFileChange) return null;

  const cleanName = isNativeProjectTool ? name.replace("project_", "") : name.split("__").at(-1) || name;
  const lowerName = cleanName.toLowerCase();

  // Project tools use operation icons and one neutral color, regardless of file type.
  if (lowerName === "bash" || lowerName === "git_status" || lowerName === "git_diff" || lowerName === "git_commit") {
    let commandStr = getShellCommand(name, args);
    if (commandStr && commandStr.length > 40) commandStr = commandStr.substring(0, 40) + "...";
    return {
      type: "bash",
      IconComponent:
        lowerName === "git_status"
          ? GitBranch
          : lowerName === "git_diff"
            ? GitCompareArrows
            : lowerName === "git_commit"
              ? GitCommitHorizontal
              : Terminal,
      colorClass: "text-text-muted",
      label: isCompleted
        ? t("chat.tools.ranCommand", { command: commandStr })
        : t("chat.tools.runningCommand", { command: commandStr }),
      detail: lowerName === "git_commit" ? args.message : undefined,
    };
  }

  // Read / Explore (grep, glob, read, list_dir)
  if (lowerName === "read_image") {
    const target = args.file_path || "image";
    const filename = target.split(/[/\\\\]/).pop() || target;
    return {
      type: "image",
      filename,
      fullPath: target,
      IconComponent: ImageIcon,
      colorClass: "text-text-muted",
      label: isCompleted ? t("chat.tools.viewedImage") : t("chat.tools.viewingImage"),
    };
  }

  const isRead = lowerName === "read";
  const isGrep = lowerName === "grep";
  const isGlob = lowerName === "glob";
  const isList = lowerName === "list_dir";

  if (isRead || isGrep || isGlob || isList) {
    const target = args.file_path || args.pattern || args.dir_path || args.path || "files";
    const filename = isRead ? target.split(/[/\\]/).pop() || target : target;
    const IconComponent = isRead ? FileTextIcon : isGrep ? Search : isGlob ? Files : FolderOpen;

    let extraInfo = "";
    if (isRead && args.offset) {
      const start = args.offset;
      const limit = args.limit || 2000;
      extraInfo = ` #L${start}-${Number(start) + Number(limit)}`;
    } else if (isCompleted && result && result.content) {
      try {
        const parsed = JSON.parse(result.content) as
          unknown[] | { FilesWithMatches?: unknown[]; Content?: unknown[]; Count?: number };
        if (isList && Array.isArray(parsed)) {
          extraInfo = " " + t("chat.tools.itemsCount", { count: String(parsed.length) });
        } else if (isGlob && Array.isArray(parsed)) {
          extraInfo = " " + t("chat.tools.matchesCount", { count: String(parsed.length) });
        } else if (isGrep) {
          if (!Array.isArray(parsed) && parsed.FilesWithMatches) {
            extraInfo = " " + t("chat.tools.filesCount", { count: String(parsed.FilesWithMatches.length) });
          } else if (!Array.isArray(parsed) && parsed.Content) {
            extraInfo = " " + t("chat.tools.linesCount", { count: String(parsed.Content.length) });
          } else if (!Array.isArray(parsed) && typeof parsed.Count === "number") {
            extraInfo = " " + t("chat.tools.matchesCount", { count: String(parsed.Count) });
          }
        }
      } catch {
        // ignore
      }
    }

    let label = isCompleted ? t("chat.tools.explored") : t("chat.tools.exploring");
    if (isRead) label = isCompleted ? t("chat.tools.analyzed") : t("chat.tools.analyzing");
    else if (isGrep) label = isCompleted ? t("chat.tools.searchedLabel") : t("chat.tools.searchingLabel");
    else if (isList) label = isCompleted ? t("chat.tools.listed") : t("chat.tools.listing");

    return {
      type: "explore",
      filename,
      IconComponent,
      colorClass: "text-text-muted",
      label,
      extraInfo,
    };
  }

  // Write / Edit
  const isWriteName = lowerName === "write" || lowerName === "edit" || isMcpFileChange;

  if (isWriteName) {
    const pathKeys = ["file_path", "path", "filepath", "filePath", "relative_path", "filename", "file"];
    for (const key of pathKeys) {
      if (typeof args[key] === "string") {
        const fullPath = args[key];
        const filename = result?.diffSummary?.filename || fullPath.split(/[/\\]/).pop() || fullPath;

        const isTodo = filename.toLowerCase().includes("todo");
        const isNew = result?.diffSummary?.isNew === true;
        const failed = result?.diffSummary?.error === true;

        return {
          type: isTodo ? "todo" : "edit",
          filename,
          IconComponent: (isNativeProjectTool && lowerName === "write") || isNew ? Save : FilePenLine,
          colorClass: "text-text-muted",
          label: isTodo
            ? isCompleted
              ? t("chat.tools.updatedTodo")
              : t("chat.tools.updatingTodo")
            : isCompleted
              ? failed
                ? isNew
                  ? t("chat.tools.createFailed")
                  : t("chat.tools.editFailed")
                : isNew
                  ? t("chat.tools.created")
                  : t("chat.tools.edited")
              : t("chat.tools.editing"),
          isTodo,
        };
      }
    }
  }

  return isNativeProjectTool
    ? {
        type: "explore",
        filename: "",
        IconComponent: Wrench,
        colorClass: "text-text-muted",
        label: formatToolName(name),
      }
    : null;
}

interface SkillResourceContent {
  path: string;
  content: string;
  offset: number;
  nextOffset?: number | null;
  totalCharacters: number;
}

interface SkillResourceInfo {
  path: string;
  size: number;
}

function parseSkillResult<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function SkillToolDetails({ message }: { message: Message }) {
  const { t } = useTranslation();
  const name = message.toolCall?.name;
  const rawResult = message.toolResult?.content || "";

  if (name === "list_skill_resources") {
    const resources = parseSkillResult<SkillResourceInfo[]>(rawResult);
    if (!Array.isArray(resources)) {
      return <SyntaxCodeBlock code={rawResult} language="plaintext" maxHeight="400px" />;
    }
    if (resources.length === 0) {
      return <p className="text-sm text-text-muted">{t("chat.tools.noSkillResources")}</p>;
    }
    return (
      <ul className="flex flex-col gap-1.5" aria-label={t("chat.tools.skillResources")}>
        {resources.map((resource) => (
          <li
            key={resource.path}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-border/40 bg-input/20 px-2.5 py-2"
          >
            <FileTextIcon size={14} className="shrink-0 text-red-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{resource.path}</span>
            <span className="shrink-0 text-xs text-text-muted">{formatFileSize(resource.size)}</span>
          </li>
        ))}
      </ul>
    );
  }

  const resource = parseSkillResult<SkillResourceContent>(rawResult);
  if (!resource || typeof resource.content !== "string") {
    return <SyntaxCodeBlock code={rawResult} language="plaintext" maxHeight="400px" />;
  }

  const extension = resource.path.split(".").pop()?.toLowerCase();
  const language = extension === "md" ? "markdown" : extension === "json" ? "json" : "plaintext";
  const chunkEnd = Math.min(resource.offset + Array.from(resource.content).length, resource.totalCharacters);

  return (
    <section className="min-w-0" aria-label={t("chat.tools.skillContent")}>
      <div className="mb-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-text-muted">
        <span className="truncate font-medium text-text-secondary">{resource.path}</span>
        <span className="shrink-0 font-mono">
          {t("chat.tools.skillCharacterRange", {
            start: String(resource.offset + 1),
            end: String(chunkEnd),
            total: String(resource.totalCharacters),
          })}
        </span>
      </div>
      <SyntaxCodeBlock code={resource.content} language={language} maxHeight="400px" />
    </section>
  );
}

function useSubagentConversationIds(message: Message): string[] {
  return useMemo(() => {
    if (message.toolResult?.subagentIds) {
      return message.toolResult.subagentIds;
    }
    if (message.toolCall?.name === "wait_subagents") {
      try {
        const args =
          typeof message.toolCall.arguments === "string"
            ? JSON.parse(message.toolCall.arguments)
            : message.toolCall.arguments;
        if (Array.isArray(args.conversationIds)) return args.conversationIds as string[];
      } catch {
        // ignore parsing error
      }
    }
    const content = message.toolResult?.content || "";
    const match = content.match(/conversation IDs?:\s*([a-zA-Z0-9-, ]+)/);
    return match
      ? match[1]
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
  }, [message]);
}

function SubagentEmbeddedChat({ conversationId }: { conversationId: string }) {
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  if (!conv) {
    return (
      <div className="bg-input/20 border border-border/40 rounded-xl p-3 text-sm text-text-muted">
        No subagent chat found.
      </div>
    );
  }

  const roleLabel = conv.role || conv.title || "Subagent";

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden bg-input/20 flex flex-col">
      <div className="w-full flex items-center justify-between p-3 border-b border-border/40 bg-input/10">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-text-primary text-sm truncate">{roleLabel}</span>
          {conv.status === "running" ? (
            <span className="flex items-center gap-1 text-[10px] text-accent/80 font-medium px-1.5 py-0.5 bg-accent/10 rounded-full shrink-0">
              <Loader2 size={10} className="animate-spin" />
              RUNNING
            </span>
          ) : conv.status === "error" ? (
            <span className="text-[10px] text-red-500 font-medium px-1.5 py-0.5 bg-red-500/10 rounded-full shrink-0">
              ERROR
            </span>
          ) : (
            <span className="text-[10px] text-emerald-500 font-medium px-1.5 py-0.5 bg-emerald-500/10 rounded-full shrink-0">
              DONE
            </span>
          )}
        </div>
        {isProjectsEnabled && (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                useUIStore.getState().setActiveSubagentId(conv.id);
              }}
              className="px-2 py-1 text-[11px] rounded bg-accent/10 hover:bg-accent/15 text-accent font-medium border border-accent/10 transition-colors flex items-center gap-1 cursor-pointer"
              title="Inspect subagent chat in panel drawer"
            >
              <ExternalLink size={10} />
              Open Drawer
            </button>
          </div>
        )}
      </div>
      <div className="h-[400px] flex flex-col relative w-full overflow-hidden">
        <ChatAreaBase
          messages={conv.messages || []}
          onRetry={(messageId) => void useChatStore.getState().retryLastMessage(conv.id, messageId)}
          conversationId={conv.id}
        />
      </div>
    </div>
  );
}

function SubagentEmbeddedChats({ message }: { message: Message }) {
  const ids = useSubagentConversationIds(message);
  if (ids.length === 0) {
    return (
      <div className="bg-input/20 border border-border/40 rounded-xl p-3 text-sm text-text-muted">
        No subagent chats found.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 w-full">
      {ids.map((id) => (
        <SubagentEmbeddedChat key={id} conversationId={id} />
      ))}
    </div>
  );
}

function SubagentToolCard({
  message,
  subagentIndex,
  subagentCount,
}: {
  message: Message;
  subagentIndex: number;
  subagentCount: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dots, setDots] = useState(".");
  const isCompleted = !!message.toolResult;
  const ids = useSubagentConversationIds(message);
  const conversationId = ids[subagentIndex];
  const conv = useChatStore((s) => (conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined));
  const roleLabel = conv?.role || conv?.title || `Subagent ${subagentIndex + 1}`;

  const isRunning = !isCompleted || conv?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isRunning]);

  const label = isCompleted ? "Invoked Subagent" : "Invoking Subagent";
  const numbered = subagentCount > 1 ? ` #${subagentIndex + 1}` : "";

  return (
    <div className="flex w-full max-w-full flex-col">
      <motion.button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-1.5 text-left text-text-muted select-none hover:text-text-primary transition-colors cursor-pointer"
        aria-label={expanded ? t("chat.tools.collapseTooltip") : t("chat.tools.expandTooltip")}
        aria-expanded={expanded}
        whileHover={{ x: 2 }}
        transition={springs.snappy}
      >
        <Users size={14} className="shrink-0" aria-hidden="true" />
        <span className="text-sm">
          {label}
          {numbered}
          {roleLabel && <span className="font-medium text-text-primary ml-1.5">— {roleLabel}</span>}
          {isRunning && <span className="ml-1">{dots}</span>}
        </span>
        <ChevronRight size={13} className={`-ml-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && conversationId && (
          <motion.div
            key={`subagent-${conversationId}`}
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: "auto", opacity: 1, marginTop: 6 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            transition={motionTransitions.content}
            className="w-full overflow-hidden"
          >
            <SubagentEmbeddedChat conversationId={conversationId} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolCallDisplay({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [dots, setDots] = useState(".");
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { name } = message.toolCall!;
  const isSearch = name === "search_query";
  const isFetch = name === "fetch_url";
  const isProject = name.startsWith("project_");
  const isMcp = name.includes("__");
  const isSkill = name === "read_skill" || name === "list_skill_resources" || name === "read_skill_resource";
  const isWaitSubagents = name === "wait_subagents";
  const isCompleted = !!message.toolResult;
  const isCollapsible = isMcp || isProject || isSkill || isWaitSubagents;
  const nativeInfo = getNativeToolDisplayInfo(name, message.toolCall?.arguments, message.toolResult, isCompleted, t);
  const diffSummary = message.toolResult?.diffSummary;
  const isFileEditDiff =
    isCompleted &&
    !!diffSummary?.hunks?.length &&
    (nativeInfo?.type === "edit" || (isMcp && !message.toolResult?.images?.length));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isWaitSubagents || isCompleted) return;
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isWaitSubagents, isCompleted]);

  if (name === "invoke_subagent") {
    const args = message.toolCall?.arguments || {};
    let subagentCount = 1;
    try {
      const raw = args.subagents;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) subagentCount = parsed.length;
    } catch {
      // ignore parse error
    }
    if (!isCompleted) subagentCount = Math.max(subagentCount, 1);

    return (
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: subagentCount }).map((_, i) => (
          <SubagentToolCard key={i} message={message} subagentIndex={i} subagentCount={subagentCount} />
        ))}
      </div>
    );
  }

  if (isCollapsible) {
    const formattedArgs = JSON.stringify(message.toolCall?.arguments || {}, null, 2);

    const rawResult = message.toolResult?.content || "";
    let formattedResult = rawResult;
    let resultLanguage = "plaintext";
    if (formattedResult) {
      try {
        const parsed = JSON.parse(formattedResult);
        formattedResult = JSON.stringify(parsed, null, 2);
        resultLanguage = "json";
      } catch {
        // keep as is
      }
    }

    const toolImages = message.toolResult?.images || [];
    const imageFilename = nativeInfo?.type === "image" ? nativeInfo.filename : undefined;
    const previewImages = toolImages.map((img, idx) => {
      const ext = img.mimeType.split("/")[1] || "png";
      return {
        url: `data:${img.mimeType};base64,${img.data}`,
        name: imageFilename || `tool_image_${idx + 1}.${ext}`,
      };
    });

    const displayName = formatToolName(name);

    return (
      <div ref={cardRef} className="flex w-full max-w-full flex-col">
        {/* The complete tool summary is the disclosure control, matching the thinking summary. */}
        <motion.button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex items-center gap-1.5 text-left text-text-muted select-none hover:text-text-primary transition-colors cursor-pointer"
          aria-label={expanded ? t("chat.tools.collapseTooltip") : t("chat.tools.expandTooltip")}
          aria-expanded={expanded}
          whileHover={{ x: 2 }}
          transition={springs.snappy}
        >
          {!nativeInfo && <Wrench size={14} className="shrink-0" aria-hidden="true" />}

          {nativeInfo ? (
            <span className="text-sm flex items-center gap-1.5">
              {nativeInfo.type === "image" ? (
                <>
                  <nativeInfo.IconComponent
                    size={14}
                    className={`${nativeInfo.colorClass} shrink-0`}
                    aria-hidden="true"
                  />
                  <span>{nativeInfo.label}</span>
                  <span className="max-w-[18rem] truncate font-medium text-text-primary">{nativeInfo.filename}</span>
                </>
              ) : nativeInfo.type === "bash" ? (
                <>
                  <nativeInfo.IconComponent
                    size={14}
                    className={`${nativeInfo.colorClass} shrink-0`}
                    aria-hidden="true"
                  />
                  <span>{nativeInfo.label}</span>
                  {nativeInfo.detail && (
                    <span className="max-w-[18rem] truncate font-medium text-text-primary">{nativeInfo.detail}</span>
                  )}
                </>
              ) : nativeInfo.type === "skill" ? (
                <>
                  <span>{nativeInfo.label}</span>
                  <span className="inline-reference inline-text-reference max-w-[14rem]">
                    <nativeInfo.IconComponent size={13} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{nativeInfo.skillId}</span>
                  </span>
                  {nativeInfo.resourcePath && (
                    <span className="max-w-[16rem] truncate font-medium text-text-primary">
                      {nativeInfo.resourcePath}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <nativeInfo.IconComponent
                    size={14}
                    className={`${nativeInfo.colorClass} shrink-0`}
                    aria-hidden="true"
                  />
                  <span>{nativeInfo.label}</span>
                  {(message.toolResult?.diffSummary?.filename || nativeInfo.filename) && (
                    <span className="max-w-[18rem] truncate font-medium text-text-primary">
                      {message.toolResult?.diffSummary?.filename || nativeInfo.filename}
                      {nativeInfo.extraInfo && (
                        <span className="text-text-muted font-normal">{nativeInfo.extraInfo}</span>
                      )}
                    </span>
                  )}
                </>
              )}

              {isWaitSubagents && !isCompleted && <span>{dots}</span>}
              {!isWaitSubagents && !isCompleted && <span>...</span>}
              {isCompleted && message.toolResult?.diffSummary && nativeInfo.type === "edit" && (
                <span className="flex items-center gap-1.5 ml-1 font-mono text-xs select-none">
                  {message.toolResult.diffSummary.error ? (
                    <AlertTriangle
                      size={13}
                      className={isProject ? "text-text-muted" : "text-amber-500"}
                      aria-label="Write failed"
                    />
                  ) : (
                    <>
                      <span className="text-emerald-600 dark:text-emerald-500 font-medium">
                        +{message.toolResult.diffSummary.added}
                      </span>
                      <span className="text-rose-500 dark:text-rose-400 font-medium">
                        -{message.toolResult.diffSummary.deleted}
                      </span>
                    </>
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm">
              {isCompleted
                ? t("chat.tools.runMcp", { name: displayName })
                : t("chat.tools.runningMcp", { name: displayName })}
            </span>
          )}

          {!isWaitSubagents && (
            <ChevronRight size={13} className={`-ml-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          )}
        </motion.button>

        {/* Collapsible Content */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="mcp-details"
              initial={{ height: 0, opacity: 0, marginTop: 0 }}
              animate={{ height: "auto", opacity: 1, marginTop: 6 }}
              exit={{ height: 0, opacity: 0, marginTop: 0 }}
              transition={motionTransitions.content}
              className="w-full overflow-hidden"
            >
              {isWaitSubagents ? (
                <SubagentEmbeddedChats message={message} />
              ) : isFileEditDiff && diffSummary?.hunks ? (
                <div className="flex flex-col gap-2 min-w-0">
                  <FileEditDiffCard
                    filename={diffSummary.filename || nativeInfo?.filename || name}
                    added={diffSummary.added}
                    deleted={diffSummary.deleted}
                    hunks={diffSummary.hunks}
                    language={diffSummary.language || "plaintext"}
                    truncated={diffSummary.truncated}
                    failed={diffSummary.error}
                  />
                  {diffSummary.error && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="font-mono break-words min-w-0">{rawResult}</span>
                    </div>
                  )}
                </div>
              ) : nativeInfo?.type === "bash" ? (
                <ShellTranscript
                  command={getShellCommand(name, message.toolCall?.arguments)}
                  output={isCompleted ? rawResult : undefined}
                />
              ) : nativeInfo?.type === "skill" ? (
                <div className="rounded-xl border border-red-500/15 bg-red-500/[0.035] p-3">
                  {isCompleted ? (
                    <SkillToolDetails message={message} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                      <Loader2 size={14} className="shrink-0 animate-spin text-red-500" aria-hidden="true" />
                      <span>{nativeInfo.label}...</span>
                    </div>
                  )}
                </div>
              ) : nativeInfo?.type === "image" ? (
                <section
                  className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-input/20"
                  aria-label={t("chat.tools.imagePreview")}
                >
                  <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
                    <ImageIcon size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
                      {nativeInfo.fullPath}
                    </span>
                    {toolImages[0]?.mimeType && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
                        {toolImages[0].mimeType.replace("image/", "")}
                      </span>
                    )}
                  </div>
                  {isCompleted && toolImages[0] ? (
                    <button
                      type="button"
                      onClick={() => setPreviewImageIndex(0)}
                      className="group flex max-h-80 w-full cursor-zoom-in items-center justify-center overflow-hidden bg-surface/60 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-inset"
                      aria-label={t("chat.tools.openImagePreview", { name: nativeInfo.filename || "image" })}
                    >
                      <img
                        src={`data:${toolImages[0].mimeType};base64,${toolImages[0].data}`}
                        alt={t("chat.tools.imagePreviewAlt", { name: nativeInfo.filename || "image" })}
                        className="max-h-72 max-w-full rounded-md object-contain shadow-sm transition-transform group-hover:scale-[1.01] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-4 text-sm text-text-muted" role="status">
                      <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
                      <span>{t("chat.tools.viewingImage")}</span>
                    </div>
                  )}
                </section>
              ) : (
                <div className="bg-input/20 border border-border/40 rounded-xl p-3 flex flex-col gap-3">
                  {/* Arguments */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium text-text-muted font-mono">
                      {t("chat.tools.arguments")}
                    </span>
                    <SyntaxCodeBlock code={formattedArgs} language="json" maxHeight="200px" />
                  </div>

                  {/* Result */}
                  {isCompleted && nativeInfo?.type === "todo" ? (
                    <div className="flex flex-col gap-1 text-sm text-text-secondary">
                      {/* Try to parse standard markdown checkboxes if we updated a TODO */}
                      {formattedResult
                        .split("\\n")
                        .filter((line) => line.trim().startsWith("- [") || line.trim().startsWith("* ["))
                        .map((line, i) => {
                          const isChecked = line.includes("[x]") || line.includes("[X]");
                          const text = line.replace(/^[-*]\s*\[.\]\s*/, "");
                          return (
                            <div key={i} className="flex items-start gap-2">
                              {isChecked ? (
                                <Check size={14} className="mt-0.5 text-emerald-500" />
                              ) : (
                                <div className="mt-0.5 w-[14px] h-[14px] border border-border rounded-sm" />
                              )}
                              <span className={isChecked ? "line-through opacity-70" : ""}>{text}</span>
                            </div>
                          );
                        })}
                      {!formattedResult.includes("[ ]") && !formattedResult.includes("[x]") && (
                        <SyntaxCodeBlock code={formattedResult} language={resultLanguage} maxHeight="400px" />
                      )}
                    </div>
                  ) : (
                    isCompleted && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium text-text-muted font-mono">
                          {t("chat.tools.result")}
                        </span>
                        <SyntaxCodeBlock code={formattedResult} language={resultLanguage} maxHeight="400px" />
                      </div>
                    )
                  )}

                  {/* Images */}
                  {isCompleted && toolImages.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium text-text-muted font-mono">
                        {t("chat.tools.images")}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {toolImages.map((img, idx) => {
                          const dataUrl = `data:${img.mimeType};base64,${img.data}`;
                          return (
                            <button
                              type="button"
                              key={idx}
                              onClick={() => setPreviewImageIndex(idx)}
                              className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface cursor-pointer hover:border-active transition-colors shrink-0"
                              title={t("chat.tools.viewImageTitle", { index: String(idx + 1) })}
                            >
                              <img
                                src={dataUrl}
                                alt={`MCP Output ${idx + 1}`}
                                className="w-full h-full object-cover select-none"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {previewImageIndex !== null && previewImages.length > 0 && !isWaitSubagents && (
                <ImagePreviewModal
                  isOpen={previewImageIndex !== null}
                  onClose={() => setPreviewImageIndex(null)}
                  images={previewImages}
                  activeIndex={previewImageIndex}
                  onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Non-MCP Tools (Search, Fetch)
  const NativeIcon = isSearch ? Search : isFetch ? Globe : Wrench;
  return (
    <div className="flex items-center gap-1.5 text-text-muted">
      <NativeIcon size={13} className="shrink-0" aria-hidden="true" />
      <span className="text-sm">
        {isCompleted
          ? isSearch
            ? t("chat.tools.searched", { query: message.toolCall?.arguments?.query || "" })
            : isFetch
              ? t("chat.tools.fetched", { url: message.toolCall?.arguments?.url || "" })
              : t("chat.tools.resultLabel")
          : isSearch
            ? t("chat.tools.searching")
            : isFetch
              ? t("chat.tools.fetching")
              : t("chat.tools.executing")}
      </span>
    </div>
  );
}

function ToolCallBubble({ message }: { message: Message }) {
  if (message.toolCall) return <ToolCallDisplay message={message} />;
  return null;
}

function LoadingText() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-xs text-text-muted font-medium font-mono">Loading{dots}</span>;
}

function ReasoningBubble({
  content,
  isStreaming,
  isReasoningComplete,
  thinkingDuration,
  conversationId,
  autoExpandReasoning,
}: {
  content: string;
  isStreaming?: boolean;
  isReasoningComplete?: boolean;
  thinkingDuration?: number;
  conversationId?: string;
  autoExpandReasoning?: boolean;
}) {
  const [prevAutoExpand, setPrevAutoExpand] = useState(autoExpandReasoning);
  const [expanded, setExpanded] = useState(!!autoExpandReasoning);
  const [elapsed, setElapsed] = useState<number | null>(null);

  if (autoExpandReasoning !== prevAutoExpand) {
    setPrevAutoExpand(autoExpandReasoning);
    if (autoExpandReasoning !== undefined) {
      setExpanded(autoExpandReasoning);
    }
  }

  const startTimestamp = useChatStore((s) =>
    conversationId && s.activeStreamThinkingStart ? s.activeStreamThinkingStart[conversationId] : undefined,
  );
  const endTimestamp = useChatStore((s) =>
    conversationId && s.activeStreamThinkingEnd ? s.activeStreamThinkingEnd[conversationId] : undefined,
  );

  const thinkingActive = isStreaming && !isReasoningComplete;
  const completedElapsed =
    startTimestamp !== undefined && endTimestamp !== undefined
      ? elapsedSeconds(startTimestamp, endTimestamp)
      : undefined;
  const displayedDuration = thinkingDuration ?? completedElapsed;

  useEffect(() => {
    if (!thinkingActive) {
      return;
    }

    const updateElapsed = () => {
      const start = startTimestamp || Date.now();
      setElapsed(elapsedSeconds(start));
    };

    updateElapsed();

    const interval = setInterval(updateElapsed, 100);
    return () => clearInterval(interval);
  }, [thinkingActive, startTimestamp]);

  return (
    <section className="text-text-muted" aria-label="Reasoning activity">
      <motion.button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-1.5 text-left text-sm select-none hover:text-text-primary transition-colors cursor-pointer"
        aria-label={expanded ? "Collapse reasoning" : "Expand reasoning"}
        aria-expanded={expanded}
        whileHover={{ x: 2 }}
        transition={springs.snappy}
      >
        {thinkingActive ? (
          <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Sparkles size={14} className="shrink-0" aria-hidden="true" />
        )}
        <span>
          {thinkingActive
            ? elapsed !== null
              ? `Thinking for ${formatElapsedDuration(elapsed)}`
              : "Thinking"
            : displayedDuration !== undefined
              ? `Thought for ${formatElapsedDuration(displayedDuration)}`
              : "Thought"}
        </span>
        <ChevronRight size={13} className={`-ml-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </motion.button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="reasoning-content"
            className="w-full overflow-hidden pl-5"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 6 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={motionTransitions.content}
          >
            <div className="overflow-hidden rounded-xl border border-border/40 bg-input/20">
              <div className="max-h-48 overflow-x-auto overflow-y-auto p-3 text-sm text-text-secondary">
                <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {content || "Thinking..."}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function AttachmentList({
  attachments,
  onImageClick,
}: {
  attachments: Attachment[];
  onImageClick: (index: number) => void;
}) {
  const imageAttachments = attachments.filter((a) => a.kind === "image" && a.dataUrl);

  return (
    <div className="flex flex-wrap gap-2 mb-2 justify-end">
      {attachments.map((a) => {
        if (a.kind === "image" && a.dataUrl) {
          const imgIdx = imageAttachments.findIndex((img) => img.id === a.id);
          return (
            <button
              type="button"
              key={a.id}
              onClick={() => onImageClick(imgIdx)}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface cursor-pointer hover:border-active transition-colors shrink-0"
              title={`View ${a.name}`}
            >
              <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover select-none" />
            </button>
          );
        } else {
          return (
            <div
              key={a.id}
              className="inline-reference py-1.5 text-xs shrink-0 max-w-[200px]"
              title={`${a.name} (${formatFileSize(a.size)})`}
            >
              <FileTextIcon size={14} className="shrink-0" aria-hidden="true" />
              <span className="truncate select-none font-medium">{a.name}</span>
            </div>
          );
        }
      })}
    </div>
  );
}

interface ParsedQuestion {
  id: string;
  title: string;
  options: { value: string; label: string }[];
  cleanedContent: string;
}

interface ToolActivityGroup {
  kind: "tool-activity";
  id: string;
  messages: Message[];
  finalMessage?: Message;
  isActive: boolean;
}

interface FinalResponseRenderItem {
  kind: "final-response";
  id: string;
  message: Message;
}

type ChatRenderItem = Message | ToolActivityGroup | FinalResponseRenderItem;

function buildChatRenderItems(messages: Message[], isConversationWorking: boolean): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let cursor = 0;

  while (cursor < messages.length) {
    const message = messages[cursor];
    if (message.role === "user") {
      items.push(message);
      cursor += 1;
      continue;
    }

    const segmentStart = cursor;
    while (cursor < messages.length && messages[cursor].role !== "user") cursor += 1;
    const segment = messages.slice(segmentStart, cursor);
    const isActiveSegment = isConversationWorking && cursor === messages.length;
    let lastToolIndex = -1;
    for (let index = segment.length - 1; index >= 0; index -= 1) {
      if (segment[index].role === "tool" && segment[index].toolCall) {
        lastToolIndex = index;
        break;
      }
    }

    if (lastToolIndex < 0) {
      items.push(...segment);
      continue;
    }

    let finalAssistantIndex = -1;
    // A streaming assistant placeholder is still provisional during an active
    // tool run: only completion tells us whether it was narration or the final response.
    if (!isActiveSegment) {
      for (let index = lastToolIndex + 1; index < segment.length; index += 1) {
        const candidate = segment[index];
        if (candidate.role === "assistant" && !candidate.isSystem) {
          finalAssistantIndex = index;
        }
      }
    }

    const activityEnd = finalAssistantIndex >= 0 ? finalAssistantIndex : segment.length;
    const activityMessages = segment
      .slice(0, activityEnd)
      .filter(
        (candidate) =>
          candidate.role !== "assistant" ||
          candidate.isSystem ||
          candidate.isStreaming === true ||
          candidate.content.trim().length > 0 ||
          candidate.reasoningContent?.trim(),
      );
    const firstTool = activityMessages.find((candidate) => candidate.role === "tool" && !!candidate.toolCall);
    const finalMessage = finalAssistantIndex >= 0 ? segment[finalAssistantIndex] : undefined;

    items.push({
      kind: "tool-activity",
      id: `tool-activity-${firstTool?.id ?? activityMessages[0].id}`,
      messages: activityMessages,
      finalMessage,
      isActive: isActiveSegment,
    });
    if (finalMessage) {
      items.push({
        kind: "final-response",
        id: finalMessage.id,
        message: finalMessage,
      });
      items.push(...segment.slice(activityEnd + 1));
    } else {
      items.push(...segment.slice(activityEnd));
    }
  }

  return items;
}

function parseQuestionBlock(content: string): ParsedQuestion | null {
  const match = content.match(/<question\s+id="([^"]+)"\s+title="([^"]+)">([\s\S]+?)<\/question>/);
  if (!match) return null;

  const [fullMatch, id, title, optionsRaw] = match;

  const options: { value: string; label: string }[] = [];
  const optionMatches = optionsRaw.matchAll(/<option\s+value="([^"]+)">([\s\S]+?)<\/option>/g);
  for (const optMatch of optionMatches) {
    options.push({ value: optMatch[1], label: optMatch[2].trim() });
  }

  const cleanedContent = content.replace(fullMatch, "").trim();

  return { id, title, options, cleanedContent };
}

function SystemNotificationBubble({ message }: { message: Message }) {
  const content = message.content;
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  const matchSuccess = content.match(
    /Subagent\s+'([^']+)'\s+\(ID:\s*([a-zA-Z0-9]+)\)\s+has finished its task\.\s*Final response:([\s\S]*)/i,
  );
  const matchFailure = content.match(/Subagent\s+'([^']+)'\s+\(ID:\s*([a-zA-Z0-9]+)\)\s+failed with error:([\s\S]*)/i);

  if (!matchSuccess && !matchFailure) {
    return (
      <div className="flex flex-col gap-2 my-4 w-full">
        <div className="flex items-center gap-1.5 text-text-muted select-none text-xs font-semibold uppercase tracking-wider">
          <Terminal size={14} className="shrink-0" />
          <span>System Notification</span>
        </div>
        <div className="border border-border/40 rounded-2xl bg-surface/50 p-4 text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  const isSuccess = !!matchSuccess;
  const role = isSuccess ? matchSuccess[1] : matchFailure![1];
  const subagentId = isSuccess ? matchSuccess[2] : matchFailure![2];
  const bodyContent = (isSuccess ? matchSuccess[3] : matchFailure![3]).trim();

  const handleOpenChat = () => {
    useUIStore.getState().setActiveSubagentId(subagentId);
  };

  return (
    <div className="flex flex-col gap-3 my-5 w-full">
      <div className="flex items-center justify-between gap-4 text-xs text-text-muted select-none">
        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider">
          {isSuccess ? (
            <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-red-500" />
          )}
          <span>{isSuccess ? "Subagent Completed" : "Subagent Failed"}</span>
        </div>
        {isProjectsEnabled && (
          <button
            onClick={handleOpenChat}
            className="flex items-center gap-1 text-accent hover:text-accent/80 hover:underline transition-colors font-medium cursor-pointer"
          >
            <span>Inspect Subagent</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      <div
        className={`border rounded-2xl p-5 shadow-sm ${
          isSuccess ? "border-border/50 bg-surface/40" : "border-red-500/20 bg-red-500/5"
        }`}
      >
        <div className="text-xs font-semibold text-text-secondary mb-3 pb-2 border-b border-border/30 flex justify-between items-center">
          <span>
            {role} ({subagentId})
          </span>
          {isSuccess ? (
            <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
              DONE
            </span>
          ) : (
            <span className="text-[10px] text-red-600 bg-red-500/10 px-2 py-0.5 rounded-full font-medium">ERROR</span>
          )}
        </div>

        <div
          className={
            isSuccess
              ? "markdown-body text-sm text-text-primary"
              : "text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap"
          }
        >
          {isSuccess ? <MessageContent content={bodyContent} isStreaming={false} /> : bodyContent}
        </div>
      </div>
    </div>
  );
}

function openWorkspaceReview(conversationId: string, filePath: string | null = null) {
  const ui = useUIStore.getState();
  ui.setActiveAuxConversationId(conversationId);
  ui.setActiveReviewFilePath(filePath);
  ui.setActiveAuxTab("review");
  ui.setAuxPanelOpen(true);
}

function WorkspaceChangeSummary({ conversationId, changes }: { conversationId: string; changes: WorkspaceChangeSet }) {
  const [expanded, setExpanded] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const fileListId = useId();
  const undoWorkspaceChanges = useChatStore((state) => state.undoWorkspaceChanges);
  const visibleFiles = expanded ? changes.files : changes.files.slice(0, 3);
  const hiddenFileCount = Math.max(changes.files.length - 3, 0);
  const additions = changes.files.reduce((total, file) => total + file.additions, 0);
  const deletions = changes.files.reduce((total, file) => total + file.deletions, 0);
  const summaryTitle = `Edited ${changes.files.length} ${changes.files.length === 1 ? "file" : "files"}`;

  const handleUndo = async () => {
    setUndoing(true);
    try {
      await undoWorkspaceChanges(conversationId, changes.undoToken);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransitions.content}
      className="my-4 w-full overflow-hidden rounded-xl border border-border/60 bg-surface/65 shadow-sm"
      aria-label="Workspace change summary"
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-3">
        <button
          type="button"
          onClick={() => openWorkspaceReview(conversationId)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={`Open ${summaryTitle.toLowerCase()} in review`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-chat/65 text-text-muted">
            <FileTextIcon size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">{summaryTitle}</span>
            <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-emerald-500">+{additions}</span>
              <span className="text-red-400">−{deletions}</span>
            </span>
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {changes.undoToken && (
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={undoing}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
              title="Undo this captured workspace patch if it still applies cleanly"
            >
              {undoing ? (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Undo2 size={12} aria-hidden="true" />
              )}
              <span>{undoing ? "Undoing" : "Undo"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openWorkspaceReview(conversationId)}
            disabled={undoing}
            className="inline-flex items-center rounded-lg border border-border bg-hover/40 px-2.5 py-1.5 text-xs font-medium text-text-primary transition-colors hover:border-text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            Review
          </button>
        </div>
      </div>

      <div className="border-t border-border/50">
        <div id={fileListId}>
          {visibleFiles.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => openWorkspaceReview(conversationId, file.path)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              aria-label={`Review workspace changes including ${file.path}`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" title={file.path}>
                {file.path}
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                <span className="text-emerald-500">+{file.additions}</span>
                <span className="text-red-400">−{file.deletions}</span>
              </span>
            </button>
          ))}
        </div>
        {hiddenFileCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls={fileListId}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border/40 px-4 py-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
          >
            <span>
              {expanded
                ? "Show fewer files"
                : `Show ${hiddenFileCount} more ${hiddenFileCount === 1 ? "file" : "files"}`}
            </span>
            <ChevronRight
              size={13}
              className={`-ml-0.5 transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </motion.section>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
  conversationId,
  autoExpandReasoning,
  hideReasoningActivity = false,
  animateEntrance = false,
}: {
  message: Message;
  onRetry?: (messageId: string) => void;
  conversationId?: string;
  autoExpandReasoning?: boolean;
  hideReasoningActivity?: boolean;
  animateEntrance?: boolean;
}) {
  const isMessageInActiveTurn = useChatStore((s) => {
    if (!conversationId) return false;
    const isConversationWorking =
      isGenerationActive(s.generationByConversation[conversationId]?.state) ||
      s.conversations.some(
        (conversation) => conversation.parentId === conversationId && conversation.status === "running",
      );
    if (!isConversationWorking) return false;

    const conversation = s.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return true;
    const messageIndex = conversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex < 0) return true;

    return !conversation.messages.slice(messageIndex + 1).some((candidate) => candidate.role === "user");
  });

  const isLastInSequence = useChatStore((s) => {
    if (message.role !== "assistant") return false;
    const conv = conversationId
      ? s.conversations.find((conversation) => conversation.id === conversationId)
      : undefined;
    if (!conv) return false;
    const idx = conv.messages.findIndex((m) => m.id === message.id);
    if (idx === -1) return false;
    const next = conv.messages[idx + 1];
    return !next || next.role === "user";
  });

  const workspaceChanges = useChatStore((state) => {
    if (message.role !== "assistant" || !conversationId) return undefined;
    const conversation = state.conversations.find((candidate) => candidate.id === conversationId);
    const storedMessage = conversation?.messages.find((candidate) => candidate.id === message.id);
    if (storedMessage?.workspaceChanges?.files.length) return storedMessage.workspaceChanges;
    if (!storedMessage && message.workspaceChanges?.files.length) return message.workspaceChanges;
    if (!conversation?.workspaceChanges?.files.length) return undefined;
    const latestAssistant = [...conversation.messages].reverse().find((candidate) => candidate.role === "assistant");
    return latestAssistant?.id === message.id ? conversation.workspaceChanges : undefined;
  });

  const isSystem = message.isSystem;
  const isUser = message.role === "user" && !isSystem;
  const isTool = message.role === "tool";
  const isStreaming = !!message.isStreaming;

  const streamContent = useChatStore((s) =>
    isStreaming && message.role === "assistant" && conversationId ? s.activeStreamContent[conversationId] : undefined,
  );
  const streamReasoning = useChatStore((s) =>
    isStreaming && message.role === "assistant" && conversationId ? s.activeStreamReasoning[conversationId] : undefined,
  );
  const combinedContent = streamContent !== undefined ? message.content + streamContent : message.content;
  const combinedReasoning =
    streamReasoning !== undefined ? (message.reasoningContent ?? "") + streamReasoning : message.reasoningContent;

  const { reasoningContent, displayContent, hasOpenReasoning } = parseReasoning(
    combinedContent,
    message.role,
    combinedReasoning,
  );
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const imageAttachments = message.attachments?.filter((a) => a.kind === "image" && a.dataUrl) || [];
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);

  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const textSizeClass =
    {
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }[baseTextSize] || "text-sm";

  if (isSystem) {
    if (message.contextDisclosure) {
      return (
        <div className="flex items-center my-4 select-none" role="status">
          <div className="flex-grow border-t border-border/40"></div>
          <span className="mx-4 max-w-xl text-center text-text-muted text-xs font-medium">{message.content}</span>
          <div className="flex-grow border-t border-border/40"></div>
        </div>
      );
    }
    const match = message.content.match(/Subagent '([^']+)'/);
    const subagentName = match ? match[1] : "Agent";
    return (
      <div className="flex items-center my-4 select-none">
        <div className="flex-grow border-t border-border/40"></div>
        <span className="mx-4 text-text-muted text-xs font-medium">Subagent &ldquo;{subagentName}&rdquo; Finished</span>
        <div className="flex-grow border-t border-border/40"></div>
      </div>
    );
  }

  if (isTool) {
    return (
      <motion.div
        className="group flex w-full justify-start"
        variants={messageVariants}
        initial={animateEntrance ? "hidden" : false}
        animate="visible"
        transition={motionTransitions.content}
      >
        <div className="w-full min-w-0">
          <ToolCallBubble message={message} />
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    if (message.content.startsWith("[System Notification]")) {
      return <SystemNotificationBubble message={message} />;
    }
    const hasAttachments = message.attachments && message.attachments.length > 0;
    return (
      <motion.div
        className="flex justify-end group"
        role="article"
        aria-label={`User message: ${message.content.slice(0, 80)}`}
        variants={messageVariants}
        initial={animateEntrance ? "hidden" : false}
        animate="visible"
        transition={motionTransitions.content}
      >
        <div className="max-w-[75%] flex flex-col items-end min-w-0">
          {hasAttachments && (
            <AttachmentList attachments={message.attachments!} onImageClick={(idx) => setPreviewImageIndex(idx)} />
          )}
          {message.content.trim().length > 0 && (
            <div
              className={`bg-input rounded-[28px] rounded-br-md px-5 py-3 ${textSizeClass} text-text-primary leading-relaxed whitespace-pre-wrap break-words w-full`}
            >
              <UserMessageContent message={message} />
            </div>
          )}
          {!isMessageInActiveTurn && (
            <div className="flex justify-end">
              <MessageActions content={message.content} isUser />
            </div>
          )}
          {previewImageIndex !== null && imageAttachments.length > 0 && (
            <ImagePreviewModal
              isOpen={previewImageIndex !== null}
              onClose={() => setPreviewImageIndex(null)}
              images={imageAttachments.map((a) => ({ url: a.dataUrl!, name: a.name, size: a.size }))}
              activeIndex={previewImageIndex}
              onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
            />
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex justify-start group"
      role="article"
      aria-label={`Assistant message${isStreaming ? " (generating)" : ""}: ${message.content.slice(0, 80)}`}
      variants={messageVariants}
      initial={animateEntrance ? "hidden" : false}
      animate="visible"
      transition={motionTransitions.content}
    >
      <div className={`max-w-none ${textSizeClass} text-text-primary leading-relaxed w-full min-w-0`}>
        {hasOpenReasoning && !hideReasoningActivity && (
          <ReasoningBubble
            content={reasoningContent}
            isStreaming={isStreaming}
            isReasoningComplete={!isStreaming || displayContent.length > 0}
            thinkingDuration={message.thinkingDuration}
            conversationId={conversationId}
            autoExpandReasoning={autoExpandReasoning}
          />
        )}
        {!hasOpenReasoning && !hideReasoningActivity && isStreaming && displayContent.length === 0 && (
          <motion.div
            className="flex items-center gap-2 py-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={motionTransitions.content}
          >
            <LoadingText />
          </motion.div>
        )}
        {(() => {
          const parsedQuestion = parseQuestionBlock(displayContent);
          const contentToRender = parsedQuestion ? parsedQuestion.cleanedContent : displayContent;
          const isAlreadyAnswered = !isLastInSequence;
          return (
            <>
              <div className={`markdown-body ${textSizeClass}`}>
                {contentToRender.length > 0 ? (
                  contentToRender === "Cancelled agent execution." ? (
                    <div
                      className="text-text-muted italic text-[13px] my-1 flex items-center gap-1.5 select-none font-medium"
                      role="status"
                      aria-live="polite"
                    >
                      Cancelled agent execution.
                    </div>
                  ) : (
                    <MessageContent
                      content={contentToRender}
                      isStreaming={isStreaming}
                      conversationId={conversationId}
                      role={message.role}
                      sources={message.sources}
                    />
                  )
                ) : null}
              </div>
              {parsedQuestion && !isStreaming && (
                <QuestionCard
                  id={parsedQuestion.id}
                  title={parsedQuestion.title}
                  options={parsedQuestion.options}
                  disabled={isAlreadyAnswered}
                  onSubmit={(_val, label) => {
                    void useChatStore.getState().sendMessage(label);
                  }}
                />
              )}
            </>
          );
        })()}
        {!isStreaming && !isMessageInActiveTurn && isLastInSequence && workspaceChanges && conversationId && (
          <WorkspaceChangeSummary conversationId={conversationId} changes={workspaceChanges} />
        )}
        {!isStreaming && !isMessageInActiveTurn && isLastInSequence && displayContent.length > 0 && (
          <MessageActions
            content={displayContent}
            sources={message.sources}
            isUser={false}
            onSourceClick={
              message.sources && message.sources.length > 0 ? () => setSourcesExpanded(!sourcesExpanded) : undefined
            }
            onRetry={() => onRetry?.(message.id)}
          />
        )}
        <AnimatePresence>
          {sourcesExpanded && message.sources && message.sources.length > 0 && (
            <SourcesList sources={message.sources} />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

function ToolActivityDisclosure({
  activity,
  isActive,
  onRetry,
  conversationId,
  autoExpandReasoning,
  animateMessageIds,
}: {
  activity: ToolActivityGroup;
  isActive: boolean;
  onRetry?: (messageId: string) => void;
  conversationId?: string;
  autoExpandReasoning?: boolean;
  animateMessageIds: ReadonlySet<string>;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(isActive);
  const previousActiveRef = useRef(isActive);

  useLayoutEffect(() => {
    if (previousActiveRef.current !== isActive) {
      setExpanded(isActive);
      previousActiveRef.current = isActive;
    }
  }, [isActive]);

  const startedAt = new Date(activity.messages[0].timestamp).getTime();
  const activeRunStartedAt = useChatStore((state) =>
    isActive && conversationId ? state.activeStreamStartTime[conversationId] : undefined,
  );
  const elapsedStartedAt = activeRunStartedAt ?? startedAt;
  const completedDuration = activity.finalMessage?.workingDuration;
  const [elapsed, setElapsed] = useState(() => {
    if (completedDuration !== undefined) return completedDuration;
    const endedAt = isActive
      ? Date.now()
      : (activity.finalMessage?.timestamp ?? activity.messages[activity.messages.length - 1].timestamp);
    return elapsedSeconds(elapsedStartedAt, new Date(endedAt).getTime());
  });

  useEffect(() => {
    if (!isActive) return;

    const updateElapsed = () => setElapsed(elapsedSeconds(elapsedStartedAt));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [elapsedStartedAt, isActive]);

  const displayedElapsed = !isActive && completedDuration !== undefined ? completedDuration : elapsed;
  const streamedFinalContent = useChatStore((state) =>
    activity.finalMessage?.isStreaming && conversationId ? state.activeStreamContent[conversationId] : undefined,
  );
  const streamedFinalReasoning = useChatStore((state) =>
    activity.finalMessage?.isStreaming && conversationId ? state.activeStreamReasoning[conversationId] : undefined,
  );
  const finalReasoning = activity.finalMessage
    ? parseReasoning(
        streamedFinalContent !== undefined
          ? activity.finalMessage.content + streamedFinalContent
          : activity.finalMessage.content,
        activity.finalMessage.role,
        streamedFinalReasoning !== undefined
          ? (activity.finalMessage.reasoningContent ?? "") + streamedFinalReasoning
          : activity.finalMessage.reasoningContent,
      )
    : undefined;

  const statusLabel = isActive
    ? `Working for ${formatElapsedDuration(displayedElapsed)}`
    : `Worked for ${formatElapsedDuration(displayedElapsed)}`;
  const latestActivityMessage =
    isActive && !activity.finalMessage
      ? [...activity.messages]
          .reverse()
          .find(
            (message) =>
              (message.role === "tool" && !!message.toolCall) ||
              (message.role === "assistant" &&
                !message.isSystem &&
                (message.isStreaming === true ||
                  message.content.trim().length > 0 ||
                  !!message.reasoningContent?.trim())),
          )
      : undefined;
  const collapsedPreviewMessage = latestActivityMessage?.role === "tool" ? latestActivityMessage : undefined;

  return (
    <motion.section
      className="w-full min-w-0 py-1"
      aria-label="Tool activity"
      variants={messageVariants}
      initial={animateMessageIds.size > 0 ? "hidden" : false}
      animate="visible"
      transition={motionTransitions.content}
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-8 w-full items-center gap-2 border-b border-border/50 py-1 text-left text-sm font-medium text-text-muted transition-colors hover:border-border hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        {isActive && (
          <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        )}
        <span>{statusLabel}</span>
        <ChevronRight
          size={14}
          className={`-ml-0.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {!expanded && collapsedPreviewMessage && (
          <motion.div
            key={`tool-activity-preview-${collapsedPreviewMessage.id}`}
            className="min-w-0 overflow-hidden pt-1"
            data-testid="working-collapsed-preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionTransitions.content}
          >
            <MessageBubble
              message={collapsedPreviewMessage}
              onRetry={onRetry}
              conversationId={conversationId}
              autoExpandReasoning={autoExpandReasoning}
              animateEntrance={false}
            />
          </motion.div>
        )}
        {expanded && (
          <motion.div
            id={contentId}
            key="tool-activity-content"
            className="min-w-0 overflow-hidden pt-1"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionTransitions.content}
          >
            {activity.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onRetry={onRetry}
                conversationId={conversationId}
                autoExpandReasoning={autoExpandReasoning}
                animateEntrance={animateMessageIds.has(message.id)}
              />
            ))}
            {finalReasoning?.hasOpenReasoning && (
              <ReasoningBubble
                content={finalReasoning.reasoningContent}
                isStreaming={activity.finalMessage?.isStreaming}
                isReasoningComplete={!activity.finalMessage?.isStreaming || finalReasoning.displayContent.length > 0}
                thinkingDuration={activity.finalMessage?.thinkingDuration}
                conversationId={conversationId}
                autoExpandReasoning={autoExpandReasoning}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function ChatRenderItemView({
  item,
  activeToolActivityId,
  onRetry,
  conversationId,
  autoExpandReasoning,
  animateMessageIds,
}: {
  item: ChatRenderItem;
  activeToolActivityId?: string;
  onRetry?: (messageId: string) => void;
  conversationId?: string;
  autoExpandReasoning?: boolean;
  animateMessageIds: ReadonlySet<string>;
}) {
  if ("kind" in item && item.kind === "tool-activity") {
    return (
      <ToolActivityDisclosure
        key={item.id}
        activity={item}
        isActive={item.id === activeToolActivityId}
        onRetry={onRetry}
        conversationId={conversationId}
        autoExpandReasoning={autoExpandReasoning}
        animateMessageIds={animateMessageIds}
      />
    );
  }

  if ("kind" in item && item.kind === "final-response") {
    return (
      <MessageBubble
        message={item.message}
        onRetry={onRetry}
        conversationId={conversationId}
        autoExpandReasoning={autoExpandReasoning}
        hideReasoningActivity
        animateEntrance={animateMessageIds.has(item.id)}
      />
    );
  }

  return (
    <MessageBubble
      message={item}
      onRetry={onRetry}
      conversationId={conversationId}
      autoExpandReasoning={autoExpandReasoning}
      animateEntrance={animateMessageIds.has(item.id)}
    />
  );
}

const VIRTUALIZED_THRESHOLD = 50;

function ChatAreaBase({
  messages,
  setIsAtBottom,
  virtuosoRef,
  onRetry,
  onScroll,
  conversationId,
  scrollContainerRef,
  autoExpandReasoning,
  showEmptyState = true,
}: ChatAreaProps) {
  const isConversationWorking = useChatStore((s) => {
    if (!conversationId) return false;
    return (
      isGenerationActive(s.generationByConversation[conversationId]?.state) ||
      s.conversations.some(
        (conversation) => conversation.parentId === conversationId && conversation.status === "running",
      )
    );
  });
  const isTemporary = useChatStore(
    (s) => s.conversations.find((conversation) => conversation.id === conversationId)?.isTemporary === true,
  );
  const renderItems = useMemo(
    () => buildChatRenderItems(messages, isConversationWorking),
    [isConversationWorking, messages],
  );
  const activeToolActivityId = isConversationWorking
    ? [...renderItems]
        .reverse()
        .find((item): item is ToolActivityGroup => "kind" in item && item.kind === "tool-activity" && item.isActive)?.id
    : undefined;
  const virtualScrollerRef = useRef<HTMLDivElement | null>(null);
  const handleVirtualScroll = useCallback(() => {
    const element = virtualScrollerRef.current;
    if (!element) return;
    const denominator = element.scrollHeight - element.clientHeight;
    onScroll?.(element.scrollTop, denominator > 0 ? element.scrollTop / denominator : 0);
  }, [onScroll]);
  const setVirtualScroller = useCallback(
    (element: HTMLElement | Window | null) => {
      if (virtualScrollerRef.current) {
        virtualScrollerRef.current.removeEventListener("scroll", handleVirtualScroll);
        delete virtualScrollerRef.current.dataset.chatScroll;
      }
      const div = element instanceof HTMLDivElement ? element : null;
      virtualScrollerRef.current = div;
      if (scrollContainerRef) scrollContainerRef.current = div;
      if (div) div.dataset.chatScroll = "";
      div?.addEventListener("scroll", handleVirtualScroll, { passive: true });
    },
    [handleVirtualScroll, scrollContainerRef],
  );

  useEffect(
    () => () => {
      virtualScrollerRef.current?.removeEventListener("scroll", handleVirtualScroll);
    },
    [handleVirtualScroll],
  );
  const messageIdsSignature = messages.map((message) => message.id).join("\u0000");
  const [messageAnimationState, setMessageAnimationState] = useState(() => ({
    conversationId,
    signature: messageIdsSignature,
    seen: new Set(messages.map((message) => message.id)),
    entering: new Set<string>(),
  }));
  let currentAnimationState = messageAnimationState;

  if (messageAnimationState.conversationId !== conversationId) {
    currentAnimationState = {
      conversationId,
      signature: messageIdsSignature,
      seen: new Set(messages.map((message) => message.id)),
      entering: new Set<string>(),
    };
    setMessageAnimationState(currentAnimationState);
  } else if (messageAnimationState.signature !== messageIdsSignature) {
    const nextEnteringIds = new Set<string>();
    const nextSeenIds = new Set(messageAnimationState.seen);
    for (const message of messages) {
      if (!nextSeenIds.has(message.id)) {
        nextSeenIds.add(message.id);
        nextEnteringIds.add(message.id);
      }
    }
    currentAnimationState = {
      conversationId,
      signature: messageIdsSignature,
      seen: nextSeenIds,
      entering: nextEnteringIds,
    };
    setMessageAnimationState(currentAnimationState);
  }

  useEffect(() => {
    if (messageAnimationState.entering.size === 0) return;
    const timer = window.setTimeout(
      () => {
        setMessageAnimationState((current) =>
          current.signature === messageAnimationState.signature ? { ...current, entering: new Set() } : current,
        );
      },
      motionTokens.duration.content * 1000 + 50,
    );
    return () => window.clearTimeout(timer);
  }, [messageAnimationState]);

  if (messages.length === 0) {
    if (!showEmptyState) {
      return (
        <div ref={scrollContainerRef} className="flex-1 min-h-0 bg-chat" role="region" aria-label="No messages yet" />
      );
    }
    return (
      <motion.div
        className="flex-1 flex flex-col items-center justify-end select-none relative pb-2 translate-y-[-7vh]"
        role="region"
        aria-label="Empty chat — type a message to begin"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={motionTransitions.panelEnter}
      >
        <div className="flex flex-col items-center gap-4 px-4">
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransitions.content}
          >
            {isTemporary ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text-primary">
                  <Ghost size={22} className="text-accent" aria-hidden="true" />
                  <h1>Temporary chat</h1>
                </div>
                <p className="text-sm text-text-muted">This chat won&apos;t be saved to your history.</p>
              </div>
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-text-primary">What should we work on?</h1>
            )}
          </motion.div>
        </div>
      </motion.div>
    );
  }

  if (renderItems.length >= VIRTUALIZED_THRESHOLD) {
    return (
      <div className="flex-1 min-h-0 min-w-0 relative" role="log" aria-label="Chat messages" aria-live="polite">
        <Virtuoso
          ref={virtuosoRef}
          data={renderItems}
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={100}
          scrollerRef={setVirtualScroller}
          itemContent={(index, item) => (
            <div className={`chat-column-content ${index > 0 ? "mt-0.5" : ""}`}>
              <ChatRenderItemView
                item={item}
                activeToolActivityId={activeToolActivityId}
                onRetry={onRetry}
                conversationId={conversationId}
                autoExpandReasoning={autoExpandReasoning}
                animateMessageIds={currentAnimationState.entering}
              />
            </div>
          )}
          components={{
            Header: () =>
              isTemporary ? (
                <div className="max-w-3xl mx-auto w-full px-6 pt-8 pb-2">
                  <div className="flex items-start gap-2.5 p-3.5 bg-accent/5 rounded-xl border border-accent/20 text-text-secondary text-xs leading-relaxed select-none">
                    <Ghost size={16} className="shrink-0 text-accent animate-pulse" />
                    <div>
                      <span className="font-semibold text-text-primary block mb-0.5">Temporary Chat</span>
                      This conversation won't be saved to history or used for training/persistence. It will be discarded
                      once you close the app or switch chats.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-4" />
              ),
            Footer: () => (
              <div className="chat-column-content">
                {/* Keep the final message scrollable above the floating composer. */}
                <div aria-hidden="true" style={{ height: "calc(var(--chat-composer-height, 14rem) + 2rem)" }} />
              </div>
            ),
          }}
          followOutput="smooth"
        />
      </div>
    );
  }

  return (
    <NonVirtualizedChatArea
      renderItems={renderItems}
      setIsAtBottom={setIsAtBottom}
      onRetry={onRetry}
      conversationId={conversationId}
      scrollContainerRef={scrollContainerRef}
      onScroll={onScroll}
      autoExpandReasoning={autoExpandReasoning}
      animateMessageIds={currentAnimationState.entering}
      activeToolActivityId={activeToolActivityId}
    />
  );
}

function NonVirtualizedChatArea({
  renderItems,
  setIsAtBottom,
  onRetry,
  conversationId,
  scrollContainerRef,
  onScroll,
  autoExpandReasoning,
  animateMessageIds,
  activeToolActivityId,
}: {
  renderItems: ChatRenderItem[];
  setIsAtBottom?: (v: boolean) => void;
  onRetry?: (messageId: string) => void;
  conversationId?: string;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (scrollTop: number, ratio: number) => void;
  autoExpandReasoning?: boolean;
  animateMessageIds: ReadonlySet<string>;
  activeToolActivityId?: string;
}) {
  const isTemporary = useChatStore(
    (s) => s.conversations.find((conversation) => conversation.id === conversationId)?.isTemporary === true,
  );
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const activeRef = scrollContainerRef || fallbackRef;
  const contentRef = useRef<HTMLDivElement>(null);

  const lastHeightRef = useRef(0);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;

    const checkAtBottom = () => {
      const target = activeRef.current;
      if (!target) return;
      const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      wasAtBottomRef.current = atBottom;
      setIsAtBottom?.(atBottom);
    };

    const handleResize = () => {
      const target = activeRef.current;
      if (!target) return;

      // If we were at the bottom and the height increased, scroll to bottom
      if (wasAtBottomRef.current && target.scrollHeight > lastHeightRef.current) {
        target.scrollTop = target.scrollHeight;
      }
      lastHeightRef.current = target.scrollHeight;
      checkAtBottom();
    };

    const handleScroll = () => {
      checkAtBottom();
      const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight);
      onScroll?.(el.scrollTop, isNaN(ratio) ? 0 : ratio);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (contentRef.current && window.ResizeObserver) {
      observer = new ResizeObserver(() => handleResize());
      observer.observe(contentRef.current);
      observer.observe(el);
    }

    lastHeightRef.current = el.scrollHeight;
    checkAtBottom();

    return () => {
      el.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
    };
  }, [setIsAtBottom, onScroll, activeRef]);

  return (
    <div
      ref={activeRef}
      data-chat-scroll
      className="flex-1 min-h-0 min-w-0 overflow-y-auto relative"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
      <div
        ref={contentRef}
        className="chat-column-content space-y-0.5 pt-8"
        style={{ paddingBottom: "calc(var(--chat-composer-height, 14rem) + 2rem)" }}
      >
        {isTemporary && (
          <div className="flex items-start gap-2.5 p-3.5 bg-accent/5 rounded-xl border border-accent/20 text-text-secondary text-xs leading-relaxed select-none mb-4 animate-fade-in">
            <Ghost size={16} className="shrink-0 text-accent animate-pulse" />
            <div>
              <span className="font-semibold text-text-primary block mb-0.5">Temporary Chat</span>
              This conversation won't be saved to history or used for training/persistence. It will be discarded once
              you close the app or switch chats.
            </div>
          </div>
        )}
        {renderItems.map((item) => (
          <ChatRenderItemView
            key={item.id}
            item={item}
            activeToolActivityId={activeToolActivityId}
            onRetry={onRetry}
            conversationId={conversationId}
            autoExpandReasoning={autoExpandReasoning}
            animateMessageIds={animateMessageIds}
          />
        ))}
        <div aria-hidden="true" className="h-1" />
      </div>
    </div>
  );
}

export default memo(ChatAreaBase);
