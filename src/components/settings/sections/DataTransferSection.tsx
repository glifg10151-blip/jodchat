import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import { Upload, Download, FileText, MessageSquare, Sparkles, Check } from "lucide-react";
import { useTranslation } from "../../../utils/i18n";
import { useChatStore } from "../../../store/useChatStore";
import { useModelStore } from "../../../store/useModelStore";
import { useKnowledgeStore } from "../../../store/useKnowledgeStore";
import { useUIStore } from "../../../store/useUIStore";
import { SettingsPanel, SettingsSectionHeader, SettingsHeaderButton } from "../components/SettingsPrimitives";
import { Select, type SelectOption } from "../../ui/Select";
import { parseImportData, type ParsedImportResult } from "../../../utils/importers";
import {
  downloadTextFile,
  conversationToMarkdown,
  exportAllConversationsToMarkdown,
  exportMemoryToMarkdown,
  exportToChatGptJson,
  exportToClaudeJson,
  exportToSythoriaJson,
} from "../../../utils/exporters";

type ExportFormat = "markdown" | "sythoria_json" | "chatgpt_json" | "claude_json";

export function DataTransferSection() {
  const { t } = useTranslation();
  const conversations = useChatStore((s) => s.conversations);
  const importConversations = useChatStore((s) => s.importConversations);
  const systemPrompt = useModelStore((s) => s.systemPrompt);
  const setSystemPrompt = useModelStore((s) => s.setSystemPrompt);
  const createCollection = useKnowledgeStore((s) => s.createCollection);
  const indexText = useKnowledgeStore((s) => s.indexText);
  const addToast = useUIStore((s) => s.addToast);

  // Import State
  const [importText, setImportText] = useState("");
  const [activeImportTab, setActiveImportTab] = useState<"file" | "paste">("file");
  const [parsedResult, setParsedResult] = useState<ParsedImportResult | null>(null);
  const [importTargetChats, setImportTargetChats] = useState(true);
  const [importTargetMemory, setImportTargetMemory] = useState(true);
  const [importTargetRag, setImportTargetRag] = useState(false);
  const [ragCollectionName, setRagCollectionName] = useState("Imported Knowledge");
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Export State
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [exportMemoryFormat, setExportMemoryFormat] = useState<"markdown" | "json">("markdown");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const EXPORT_FORMAT_OPTIONS: SelectOption[] = [
    {
      value: "markdown",
      label: "Markdown (.md)",
      description: "Human-readable chat logs with formatted code blocks",
    },
    {
      value: "sythoria_json",
      label: "Sythoria Backup (.json)",
      description: "Complete lossless archive including tools and metadata",
    },
    {
      value: "chatgpt_json",
      label: "ChatGPT Format (.json)",
      description: "OpenAI conversations.json tree format",
    },
    {
      value: "claude_json",
      label: "Claude Format (.json)",
      description: "Anthropic Claude conversations format",
    },
  ];

  const EXPORT_MEMORY_OPTIONS: SelectOption[] = [
    {
      value: "markdown",
      label: "Markdown (.md)",
      description: "Clean document containing system instructions and memories",
    },
    {
      value: "json",
      label: "JSON (.json)",
      description: "Structured memory object with facts and instructions",
    },
  ];

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = parseImportData(text, file.name);
      setParsedResult(result);
      setImportTargetChats(result.conversations.length > 0);
      setImportTargetMemory(Boolean(result.systemPrompt || result.memories.length > 0));
      setRagCollectionName(`Imported: ${result.detectedFormatName}`);
      addToast(
        `Parsed ${result.detectedFormatName}: ${result.stats.conversationCount} chats, ${result.stats.memoryItemCount} memories`,
        "info",
      );
    } catch {
      addToast("Failed to parse import file", "error");
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void handleFile(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleFile(files[0]);
    }
  };

  const handleParsePastedText = () => {
    if (!importText.trim()) return;
    const result = parseImportData(importText.trim(), "Pasted Memory.md");
    setParsedResult(result);
    setImportTargetChats(result.conversations.length > 0);
    setImportTargetMemory(Boolean(result.systemPrompt || result.memories.length > 0));
    setRagCollectionName(`Imported: ${result.detectedFormatName}`);
  };

  const handleExecuteImport = async () => {
    if (!parsedResult) return;
    setIsProcessingImport(true);

    try {
      // 1. Import Conversations
      if (importTargetChats && parsedResult.conversations.length > 0) {
        await importConversations(parsedResult.conversations);
      }

      // 2. Import into Global System Prompt / Memory
      if (importTargetMemory) {
        const newInstructions =
          parsedResult.systemPrompt || parsedResult.memories.map((m) => `## ${m.title}\n${m.content}`).join("\n\n");

        if (newInstructions.trim()) {
          const merged = systemPrompt ? `${systemPrompt}\n\n${newInstructions.trim()}` : newInstructions.trim();
          setSystemPrompt(merged);
        }
      }

      // 3. Import into Knowledge Base / Vector RAG Collection
      if (importTargetRag) {
        const colName = ragCollectionName.trim() || "Imported Knowledge";
        const newCol = await createCollection(colName, `Imported from ${parsedResult.detectedFormatName}`);
        if (newCol) {
          // Index memories or conversation summaries
          for (const mem of parsedResult.memories) {
            await indexText(newCol.id, mem.title, mem.content);
          }
          for (const conv of parsedResult.conversations) {
            const convMd = conversationToMarkdown(conv);
            await indexText(newCol.id, conv.title, convMd);
          }
        }
      }

      addToast("Data imported successfully", "success");
      setParsedResult(null);
      setImportText("");
    } catch {
      addToast("Failed to complete data import", "error");
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleExportConversations = () => {
    if (conversations.length === 0) {
      addToast("No conversations to export", "info");
      return;
    }

    const timestampStr = new Date().toISOString().slice(0, 10);

    if (exportFormat === "markdown") {
      const content = exportAllConversationsToMarkdown(conversations);
      downloadTextFile(`sythoria_conversations_${timestampStr}.md`, content, "text/markdown;charset=utf-8");
    } else if (exportFormat === "sythoria_json") {
      const content = exportToSythoriaJson(conversations, systemPrompt);
      downloadTextFile(`sythoria_backup_${timestampStr}.json`, content, "application/json;charset=utf-8");
    } else if (exportFormat === "chatgpt_json") {
      const content = exportToChatGptJson(conversations);
      downloadTextFile(`chatgpt_conversations_${timestampStr}.json`, content, "application/json;charset=utf-8");
    } else if (exportFormat === "claude_json") {
      const content = exportToClaudeJson(conversations);
      downloadTextFile(`claude_conversations_${timestampStr}.json`, content, "application/json;charset=utf-8");
    }

    addToast("Export downloaded", "success");
  };

  const handleExportMemory = () => {
    const timestampStr = new Date().toISOString().slice(0, 10);

    if (exportMemoryFormat === "markdown") {
      const content = exportMemoryToMarkdown(systemPrompt);
      downloadTextFile(`sythoria_memory_${timestampStr}.md`, content, "text/markdown;charset=utf-8");
    } else {
      const payload = {
        app: "Sythoria",
        exported_at: new Date().toISOString(),
        systemPrompt,
      };
      downloadTextFile(
        `sythoria_memory_${timestampStr}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
    }

    addToast("Memory exported", "success");
  };

  return (
    <div className="space-y-6">
      {/* Import Hub */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.dataTransfer.importTitle") || "Import Data & Memory"}
          description={
            t("settings.dataTransfer.importSubtitle") ||
            "Import conversations, custom instructions, and memories from ChatGPT, Claude, Google Gemini, or Sythoria backups."
          }
        />

        <div className="flex gap-2 my-3 border-b border-border/40 pb-2">
          <button
            onClick={() => setActiveImportTab("file")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeImportTab === "file"
                ? "bg-accent/15 text-accent border border-accent/30"
                : "text-text-muted hover:text-text-primary hover:bg-hover"
            }`}
          >
            Upload Export File (.json / .md / .txt)
          </button>
          <button
            onClick={() => setActiveImportTab("paste")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeImportTab === "paste"
                ? "bg-accent/15 text-accent border border-accent/30"
                : "text-text-muted hover:text-text-primary hover:bg-hover"
            }`}
          >
            Paste Text or Notes
          </button>
        </div>

        {activeImportTab === "file" ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.txt"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-accent bg-accent/10"
                  : "border-border/60 hover:border-accent/50 bg-input/20 hover:bg-input/40"
              }`}
            >
              <Upload className="w-8 h-8 text-accent mb-2" />
              <div className="text-sm font-medium text-text-primary">Click to browse or drag & drop export file</div>
              <div className="text-xs text-text-muted mt-1">
                Supports ChatGPT <code className="text-xs bg-hover px-1 py-0.5 rounded">conversations.json</code>,
                Claude, Google Gemini, and Sythoria backups
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste ChatGPT Memory, Claude Custom Instructions, JSON data, or Markdown notes here..."
              rows={5}
              className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-accent resize-y font-mono"
            />
            <div className="flex justify-end">
              <SettingsHeaderButton onClick={handleParsePastedText} disabled={!importText.trim()}>
                Inspect & Preview
              </SettingsHeaderButton>
            </div>
          </div>
        )}

        {/* Parsed Result Preview Card */}
        {parsedResult && (
          <div className="mt-4 p-4 rounded-xl border border-accent/40 bg-accent/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-text-primary">{parsedResult.detectedFormatName}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>{parsedResult.stats.conversationCount} chats</span>
                <span>•</span>
                <span>{parsedResult.stats.messageCount} messages</span>
                <span>•</span>
                <span>{parsedResult.stats.memoryItemCount} memories</span>
              </div>
            </div>

            {/* Destination Selection */}
            <div className="pt-2 border-t border-border/40 space-y-2">
              <div className="text-xs font-medium text-text-muted">Choose Import Destinations:</div>
              {parsedResult.conversations.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importTargetChats}
                    onChange={(e) => setImportTargetChats(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Add {parsedResult.conversations.length} conversation(s) to Chat History</span>
                </label>
              )}
              {(parsedResult.systemPrompt || parsedResult.memories.length > 0) && (
                <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importTargetMemory}
                    onChange={(e) => setImportTargetMemory(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Append instructions to Global System Prompt & Memory</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={importTargetRag}
                  onChange={(e) => setImportTargetRag(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Index into a local Knowledge & Vector RAG Collection</span>
              </label>

              {importTargetRag && (
                <input
                  type="text"
                  value={ragCollectionName}
                  onChange={(e) => setRagCollectionName(e.target.value)}
                  placeholder="Collection Name"
                  className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-accent mt-1"
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setParsedResult(null)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:bg-hover"
              >
                Cancel
              </button>
              <SettingsHeaderButton
                onClick={handleExecuteImport}
                disabled={isProcessingImport || (!importTargetChats && !importTargetMemory && !importTargetRag)}
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                {isProcessingImport ? "Importing..." : "Complete Import"}
              </SettingsHeaderButton>
            </div>
          </div>
        )}
      </SettingsPanel>

      {/* Export Hub */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.dataTransfer.exportTitle") || "Export Data & Chat History"}
          description={
            t("settings.dataTransfer.exportSubtitle") ||
            "Export conversations and system memory to Markdown, Sythoria backup format, ChatGPT JSON, or Claude JSON."
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-3">
          {/* Export Conversations */}
          <div className="p-4 rounded-xl border border-border bg-input/30 space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-text-primary">Chat History</span>
              </div>
              <p className="text-xs text-text-muted mb-3">
                Export all {conversations.length} conversation(s) and messages.
              </p>
              <Select
                value={exportFormat}
                options={EXPORT_FORMAT_OPTIONS}
                onChange={(val) => setExportFormat(val as ExportFormat)}
              />
            </div>
            <SettingsHeaderButton onClick={handleExportConversations}>
              <Download className="w-4 h-4 mr-1.5" />
              Export Conversations
            </SettingsHeaderButton>
          </div>

          {/* Export Memory & Instructions */}
          <div className="p-4 rounded-xl border border-border bg-input/30 space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-text-primary">Memory & Instructions</span>
              </div>
              <p className="text-xs text-text-muted mb-3">
                Export your global system prompt and customized profile instructions.
              </p>
              <Select
                value={exportMemoryFormat}
                options={EXPORT_MEMORY_OPTIONS}
                onChange={(val) => setExportMemoryFormat(val as "markdown" | "json")}
              />
            </div>
            <SettingsHeaderButton onClick={handleExportMemory}>
              <Download className="w-4 h-4 mr-1.5" />
              Export Memory
            </SettingsHeaderButton>
          </div>
        </div>
      </SettingsPanel>
    </div>
  );
}
