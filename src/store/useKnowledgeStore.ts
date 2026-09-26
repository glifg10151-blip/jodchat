import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeSearchResultChunk,
  EmbeddingProviderConfig,
  RagStats,
} from "../types";
import { logError, logInfo } from "../utils/logger";

interface KnowledgeState {
  collections: KnowledgeCollection[];
  activeCollectionId: string | null;
  documents: Record<string, KnowledgeDocument[]>;
  stats: RagStats | null;
  defaultEmbeddingConfig: EmbeddingProviderConfig;
  isIndexing: boolean;
  indexingProgress: number;
  lastSearchResults: KnowledgeSearchResultChunk[];
  isLoading: boolean;

  setActiveCollectionId: (id: string | null) => void;
  setDefaultEmbeddingConfig: (config: EmbeddingProviderConfig) => void;
  loadCollections: () => Promise<void>;
  createCollection: (
    name: string,
    description?: string,
    provider?: string,
    model?: string,
    chunkSize?: number,
    chunkOverlap?: number,
  ) => Promise<KnowledgeCollection | null>;
  deleteCollection: (id: string) => Promise<void>;
  loadDocuments: (collectionId: string) => Promise<void>;
  indexFile: (collectionId: string, filePath: string) => Promise<KnowledgeDocument | null>;
  indexText: (collectionId: string, title: string, content: string) => Promise<KnowledgeDocument | null>;
  deleteDocument: (documentId: string, collectionId: string) => Promise<void>;
  search: (
    collectionId: string,
    query: string,
    topK?: number,
    minScore?: number,
  ) => Promise<KnowledgeSearchResultChunk[]>;
  loadStats: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  collections: [],
  activeCollectionId: null,
  documents: {},
  stats: null,
  defaultEmbeddingConfig: {
    type: "ollama",
    endpoint: "http://localhost:11434",
    model: "nomic-embed-text",
  },
  isIndexing: false,
  indexingProgress: 0,
  lastSearchResults: [],
  isLoading: false,

  setActiveCollectionId: (id) => {
    set({ activeCollectionId: id });
    if (id) {
      void get().loadDocuments(id);
    }
  },

  setDefaultEmbeddingConfig: (config) => {
    set({ defaultEmbeddingConfig: config });
  },

  loadCollections: async () => {
    set({ isLoading: true });
    try {
      const collections = await invoke<KnowledgeCollection[]>("rag_list_collections");
      set({
        collections,
        activeCollectionId: get().activeCollectionId || (collections.length > 0 ? collections[0].id : null),
      });
      if (collections.length > 0) {
        const activeId = get().activeCollectionId || collections[0].id;
        void get().loadDocuments(activeId);
      }
      void get().loadStats();
    } catch (err) {
      logError("general", `Failed to load knowledge collections: ${err}`);
    } finally {
      set({ isLoading: false });
    }
  },

  createCollection: async (
    name,
    description,
    provider = "ollama",
    model = "nomic-embed-text",
    chunkSize = 800,
    chunkOverlap = 150,
  ) => {
    try {
      const collection = await invoke<KnowledgeCollection>("rag_create_collection", {
        name,
        description: description || null,
        embeddingProvider: provider,
        embeddingModel: model,
        chunkSize,
        chunkOverlap,
      });

      set((state) => ({
        collections: [collection, ...state.collections],
        activeCollectionId: collection.id,
      }));

      logInfo("general", `Created knowledge collection: ${name}`);
      void get().loadStats();
      return collection;
    } catch (err) {
      logError("general", `Failed to create collection: ${err}`);
      return null;
    }
  },

  deleteCollection: async (id) => {
    try {
      await invoke("rag_delete_collection", { collectionId: id });
      set((state) => {
        const remaining = state.collections.filter((c) => c.id !== id);
        const docs = { ...state.documents };
        delete docs[id];
        return {
          collections: remaining,
          activeCollectionId: state.activeCollectionId === id ? (remaining[0]?.id ?? null) : state.activeCollectionId,
          documents: docs,
        };
      });
      logInfo("general", `Deleted knowledge collection: ${id}`);
      void get().loadStats();
    } catch (err) {
      logError("general", `Failed to delete collection: ${err}`);
    }
  },

  loadDocuments: async (collectionId) => {
    try {
      const docs = await invoke<KnowledgeDocument[]>("rag_list_documents", { collectionId });
      set((state) => ({
        documents: {
          ...state.documents,
          [collectionId]: docs,
        },
      }));
    } catch (err) {
      logError("general", `Failed to load documents for ${collectionId}: ${err}`);
    }
  },

  indexFile: async (collectionId, filePath) => {
    set({ isIndexing: true, indexingProgress: 10 });
    try {
      const providerConfig = get().defaultEmbeddingConfig;
      const doc = await invoke<KnowledgeDocument>("rag_index_file", {
        collectionId,
        filePath,
        providerConfig,
      });

      set((state) => {
        const currentDocs = state.documents[collectionId] || [];
        return {
          documents: {
            ...state.documents,
            [collectionId]: [doc, ...currentDocs],
          },
          isIndexing: false,
          indexingProgress: 100,
        };
      });

      // Update collection stats
      void get().loadCollections();
      logInfo("general", `Indexed file into collection: ${doc.name}`);
      return doc;
    } catch (err) {
      logError("general", `Failed to index file ${filePath}: ${err}`);
      set({ isIndexing: false, indexingProgress: 0 });
      return null;
    }
  },

  indexText: async (collectionId, title, content) => {
    set({ isIndexing: true, indexingProgress: 10 });
    try {
      const providerConfig = get().defaultEmbeddingConfig;
      const doc = await invoke<KnowledgeDocument>("rag_index_text", {
        collectionId,
        title,
        content,
        providerConfig,
      });

      set((state) => {
        const currentDocs = state.documents[collectionId] || [];
        return {
          documents: {
            ...state.documents,
            [collectionId]: [doc, ...currentDocs],
          },
          isIndexing: false,
          indexingProgress: 100,
        };
      });

      void get().loadCollections();
      logInfo("general", `Indexed text snippet: ${title}`);
      return doc;
    } catch (err) {
      logError("general", `Failed to index text: ${err}`);
      set({ isIndexing: false, indexingProgress: 0 });
      return null;
    }
  },

  deleteDocument: async (documentId, collectionId) => {
    try {
      await invoke("rag_delete_document", { documentId });
      set((state) => ({
        documents: {
          ...state.documents,
          [collectionId]: (state.documents[collectionId] || []).filter((d) => d.id !== documentId),
        },
      }));
      void get().loadCollections();
      void get().loadStats();
    } catch (err) {
      logError("general", `Failed to delete document ${documentId}: ${err}`);
    }
  },

  search: async (collectionId, query, topK = 5, minScore = 0.0) => {
    try {
      const providerConfig = get().defaultEmbeddingConfig;
      const results = await invoke<KnowledgeSearchResultChunk[]>("rag_search", {
        collectionId,
        query,
        topK,
        minScore,
        providerConfig,
      });
      set({ lastSearchResults: results });
      return results;
    } catch (err) {
      logError("general", `Failed to execute RAG search on ${collectionId}: ${err}`);
      return [];
    }
  },

  loadStats: async () => {
    try {
      const stats = await invoke<RagStats>("rag_get_stats");
      set({ stats });
    } catch (err) {
      logError("general", `Failed to get RAG stats: ${err}`);
    }
  },

  clearAll: async () => {
    try {
      await invoke("rag_clear_all");
      set({
        collections: [],
        activeCollectionId: null,
        documents: {},
        stats: null,
        lastSearchResults: [],
      });
      logInfo("general", "Cleared all RAG data and vacuumed database");
    } catch (err) {
      logError("general", `Failed to clear RAG database: ${err}`);
    }
  },
}));
