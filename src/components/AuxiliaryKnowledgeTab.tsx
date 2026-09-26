import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { Database, Plus, Trash2, FileText, Upload, Loader2, Sparkles, BookOpen, X } from "lucide-react";
import { useKnowledgeStore } from "../store/useKnowledgeStore";
import { Select, type SelectOption } from "./ui/Select";
import type { KnowledgeSearchResultChunk } from "../types";

export function AuxiliaryKnowledgeTab() {
  const {
    collections,
    activeCollectionId,
    documents,
    isIndexing,
    setActiveCollectionId,
    loadCollections,
    createCollection,
    indexFile,
    indexText,
    deleteDocument,
    search,
  } = useKnowledgeStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResultChunk[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColDesc, setNewColDesc] = useState("");

  const [showTextModal, setShowTextModal] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const activeDocs = activeCollectionId ? documents[activeCollectionId] || [] : [];
  const activeCol = collections.find((c) => c.id === activeCollectionId);

  const collectionOptions: SelectOption[] =
    collections.length > 0
      ? collections.map((c) => ({
          value: c.id,
          label: c.name,
          description: `${c.document_count} documents • ${c.chunk_count} chunks`,
        }))
      : [{ value: "", label: "No collections" }];

  const handleSearch = async () => {
    if (!activeCollectionId || !searchQuery.trim()) return;
    setIsSearching(true);
    const results = await search(activeCollectionId, searchQuery.trim(), 5, 0.0);
    setSearchResults(results);
    setIsSearching(false);
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    await createCollection(newColName.trim(), newColDesc.trim());
    setNewColName("");
    setNewColDesc("");
    setShowCreateModal(false);
  };

  const handleIndexText = async () => {
    if (!activeCollectionId || !textTitle.trim() || !textContent.trim()) return;
    await indexText(activeCollectionId, textTitle.trim(), textContent.trim());
    setTextTitle("");
    setTextContent("");
    setShowTextModal(false);
  };

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeCollectionId) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) {
        await indexFile(activeCollectionId, filePath);
      } else {
        const text = await file.text();
        await indexText(activeCollectionId, file.name, text);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-text-primary">
      {/* Header & Collection Selector */}
      <div className="p-3 border-b border-border/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Database className="w-4 h-4 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <Select
              size="compact"
              value={activeCollectionId || ""}
              options={collectionOptions}
              onChange={(val) => setActiveCollectionId(val || null)}
              placeholder="Select collection..."
            />
          </div>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="p-1.5 rounded-lg bg-hover/40 hover:bg-hover border border-border/50 text-text-muted hover:text-text-primary transition-colors shrink-0"
          title="New Collection"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Indexing Indicator */}
        {isIndexing && (
          <div className="p-3 rounded-xl border border-accent/30 bg-accent/10 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-accent">Indexing document...</div>
              <div className="text-text-muted mt-0.5">Chunking and computing semantic vectors</div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {activeCollectionId && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-border/40 bg-hover/20 hover:bg-hover/40 text-xs font-medium text-text-primary transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-accent" />
              Upload PDF / Doc
            </button>
            <button
              onClick={() => setShowTextModal(true)}
              className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-border/40 bg-hover/20 hover:bg-hover/40 text-xs font-medium text-text-primary transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-accent" />
              Paste Text
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.rs,.ts,.tsx,.py,.js"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}

        {/* Search Test Sandbox */}
        {activeCollectionId && (
          <div className="p-3 rounded-xl border border-border/40 bg-hover/20 space-y-2">
            <div className="text-xs font-medium text-text-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              Test Hybrid RAG Search
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                placeholder="Ask or search inside these docs..."
                className="flex-1 bg-background border border-border/50 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="px-2.5 py-1 bg-accent text-white rounded-lg text-xs hover:bg-accent/90 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2 mt-2 pt-2 border-t border-border/30">
                <div className="text-[11px] text-text-muted">Top Retrieved Chunks:</div>
                {searchResults.map((r) => (
                  <div key={r.chunk_id} className="p-2 rounded-lg bg-background/80 border border-border/40 text-xs">
                    <div className="flex items-center justify-between text-[10px] text-accent font-medium mb-1">
                      <span className="truncate max-w-[180px]">
                        {r.document_name} {r.page_number ? `(p. ${r.page_number})` : ""}
                      </span>
                      <span>Score: {(r.similarity_score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-text-muted line-clamp-3 text-[11px]">{r.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Documents List */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-text-muted flex items-center justify-between">
            <span>Indexed Documents ({activeDocs.length})</span>
            {activeCol && (
              <span className="text-[10px] text-text-muted/70">
                {activeCol.embedding_provider} • {activeCol.chunk_count} chunks
              </span>
            )}
          </div>

          {activeDocs.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-xs border border-dashed border-border/40 rounded-xl p-4">
              <BookOpen className="w-8 h-8 mx-auto text-text-muted/40 mb-2" />
              <div>No documents in this collection yet.</div>
              <div className="text-[11px] text-text-muted/60 mt-0.5">Upload a PDF or paste text to start.</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/30 bg-hover/10 hover:bg-hover/20 transition-colors text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-accent shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary truncate">{doc.name}</div>
                      <div className="text-[10px] text-text-muted">
                        {doc.chunk_count} chunks • {doc.mime_type.split("/").pop()}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => activeCollectionId && deleteDocument(doc.id, activeCollectionId)}
                    className="p-1 text-text-muted hover:text-red-500 rounded transition-colors shrink-0"
                    title="Delete Document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Collection Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border/60 rounded-2xl p-4 w-full max-w-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">New Collection</div>
              <button onClick={() => setShowCreateModal(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label htmlFor="new-collection-name" className="text-xs text-text-muted block mb-1">
                Collection Name
              </label>
              <input
                id="new-collection-name"
                type="text"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="e.g. Work Docs"
                className="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="new-collection-desc" className="text-xs text-text-muted block mb-1">
                Description (Optional)
              </label>
              <input
                id="new-collection-desc"
                type="text"
                value={newColDesc}
                onChange={(e) => setNewColDesc(e.target.value)}
                placeholder="Brief description"
                className="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 border border-border/50 rounded-lg text-xs text-text-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCollection}
                disabled={!newColName.trim()}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent/90 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paste Text Snippet Modal */}
      {showTextModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border/60 rounded-2xl p-4 w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Add Text Snippet</div>
              <button onClick={() => setShowTextModal(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label htmlFor="snippet-title" className="text-xs text-text-muted block mb-1">
                Title
              </label>
              <input
                id="snippet-title"
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="Document or Snippet Title"
                className="w-full bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="snippet-content" className="text-xs text-text-muted block mb-1">
                Content
              </label>
              <textarea
                id="snippet-content"
                rows={6}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Paste raw text, notes, or markdown here..."
                className="w-full bg-background border border-border/50 rounded-lg p-2.5 text-xs focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowTextModal(false)}
                className="px-3 py-1.5 border border-border/50 rounded-lg text-xs text-text-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleIndexText}
                disabled={!textTitle.trim() || !textContent.trim()}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs hover:bg-accent/90 disabled:opacity-50"
              >
                Index Text
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
