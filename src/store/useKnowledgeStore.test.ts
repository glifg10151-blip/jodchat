import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKnowledgeStore } from "./useKnowledgeStore";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useKnowledgeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKnowledgeStore.setState({
      collections: [],
      activeCollectionId: null,
      documents: {},
      stats: null,
      lastSearchResults: [],
      isLoading: false,
      isIndexing: false,
    });
  });

  it("loads collections and activates the first one", async () => {
    const mockCollections = [
      {
        id: "col-1",
        name: "Manuals",
        description: "App manuals",
        embedding_provider: "ollama",
        embedding_model: "nomic-embed-text",
        chunk_size: 800,
        chunk_overlap: 150,
        document_count: 2,
        chunk_count: 10,
        created_at: 1000,
        updated_at: 1000,
      },
    ];

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "rag_list_collections") return mockCollections;
      if (cmd === "rag_list_documents") return [];
      if (cmd === "rag_get_stats") {
        return { collection_count: 1, document_count: 2, chunk_count: 10, db_size_bytes: 4096 };
      }
      return null;
    });

    await useKnowledgeStore.getState().loadCollections();

    const state = useKnowledgeStore.getState();
    expect(state.collections).toHaveLength(1);
    expect(state.collections[0].name).toBe("Manuals");
    expect(state.activeCollectionId).toBe("col-1");
  });

  it("creates a new collection and adds it to state", async () => {
    const newCol = {
      id: "col-new",
      name: "Research",
      description: "AI Papers",
      embedding_provider: "openai",
      embedding_model: "text-embedding-3-small",
      chunk_size: 800,
      chunk_overlap: 150,
      document_count: 0,
      chunk_count: 0,
      created_at: 2000,
      updated_at: 2000,
    };

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "rag_create_collection") return newCol;
      if (cmd === "rag_get_stats") {
        return { collection_count: 1, document_count: 0, chunk_count: 0, db_size_bytes: 1024 };
      }
      return null;
    });

    const result = await useKnowledgeStore
      .getState()
      .createCollection("Research", "AI Papers", "openai", "text-embedding-3-small");

    expect(result).toEqual(newCol);
    expect(useKnowledgeStore.getState().collections).toContainEqual(newCol);
    expect(useKnowledgeStore.getState().activeCollectionId).toBe("col-new");
  });

  it("executes hybrid search and saves lastSearchResults", async () => {
    const mockResults = [
      {
        chunk_id: "chunk-1",
        document_id: "doc-1",
        document_name: "Manual.pdf",
        collection_id: "col-1",
        chunk_index: 0,
        content: "Here is how Sythoria works.",
        page_number: 1,
        similarity_score: 0.92,
        rrf_score: 0.033,
        metadata_json: "{}",
      },
    ];

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "rag_search") return mockResults;
      return null;
    });

    const results = await useKnowledgeStore.getState().search("col-1", "how does Sythoria work", 5);

    expect(results).toHaveLength(1);
    expect(results[0].document_name).toBe("Manual.pdf");
    expect(useKnowledgeStore.getState().lastSearchResults).toEqual(mockResults);
  });
});
