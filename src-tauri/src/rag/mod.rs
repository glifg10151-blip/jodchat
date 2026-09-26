pub mod chunker;
pub mod embeddings;
pub mod parser;
pub mod retrieval;
pub mod storage;

use crate::AppError;
use embeddings::{generate_embeddings, EmbeddingProvider};
use retrieval::SearchResultChunk;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use storage::{KnowledgeCollection, KnowledgeDocument, RagStats, StoredChunk};
use tauri::{AppHandle, Manager};

pub struct RagManager {
    db_path: PathBuf,
    client: reqwest::Client,
    conn_mutex: Arc<Mutex<()>>,
}

impl RagManager {
    pub fn new(app_data_dir: &Path) -> Result<Self, AppError> {
        let rag_dir = app_data_dir.join("rag");
        let db_path = rag_dir.join("knowledge.db");
        let _ = storage::open_or_create_db(&db_path)?;

        Ok(Self {
            db_path,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            conn_mutex: Arc::new(Mutex::new(())),
        })
    }

    fn get_connection(&self) -> Result<rusqlite::Connection, AppError> {
        let _lock = self
            .conn_mutex
            .lock()
            .map_err(|_| AppError::RagError("RAG mutex poisoned".to_string()))?;
        storage::open_or_create_db(&self.db_path)
    }
}

fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))
}

#[tauri::command]
pub async fn rag_create_collection(
    app: AppHandle,
    name: String,
    description: Option<String>,
    embedding_provider: String,
    embedding_model: String,
    chunk_size: Option<usize>,
    chunk_overlap: Option<usize>,
) -> Result<KnowledgeCollection, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    let now = chrono::Utc::now().timestamp_millis();
    let id = uuid::Uuid::new_v4().to_string();

    let collection = KnowledgeCollection {
        id,
        name,
        description,
        embedding_provider,
        embedding_model,
        chunk_size: chunk_size.unwrap_or(800),
        chunk_overlap: chunk_overlap.unwrap_or(150),
        document_count: 0,
        chunk_count: 0,
        created_at: now,
        updated_at: now,
    };

    storage::create_collection(&conn, &collection)?;
    Ok(collection)
}

#[tauri::command]
pub async fn rag_list_collections(app: AppHandle) -> Result<Vec<KnowledgeCollection>, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    storage::list_collections(&conn)
}

#[tauri::command]
pub async fn rag_get_collection(
    app: AppHandle,
    collection_id: String,
) -> Result<Option<KnowledgeCollection>, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    storage::get_collection(&conn, &collection_id)
}

#[tauri::command]
pub async fn rag_delete_collection(app: AppHandle, collection_id: String) -> Result<(), AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    storage::delete_collection(&conn, &collection_id)
}

#[tauri::command]
pub async fn rag_index_file(
    app: AppHandle,
    collection_id: String,
    file_path: String,
    provider_config: Option<EmbeddingProvider>,
) -> Result<KnowledgeDocument, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let mut conn = manager.get_connection()?;

    let collection = storage::get_collection(&conn, &collection_id)?
        .ok_or_else(|| AppError::RagError("Collection not found".to_string()))?;

    let path = PathBuf::from(&file_path);
    let parsed_doc = parser::extract_document(&path)?;

    let raw_chunks =
        chunker::chunk_document(&parsed_doc, collection.chunk_size, collection.chunk_overlap);

    let provider = provider_config.unwrap_or_else(|| EmbeddingProvider::Ollama {
        endpoint: "http://localhost:11434".to_string(),
        model: collection.embedding_model.clone(),
    });

    let chunk_texts: Vec<String> = raw_chunks.iter().map(|c| c.content.clone()).collect();
    let embeddings = generate_embeddings(&manager.client, &provider, &chunk_texts).await?;

    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let file_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) as usize;

    let doc = KnowledgeDocument {
        id: doc_id.clone(),
        collection_id: collection_id.clone(),
        name: parsed_doc.title,
        path: Some(file_path),
        mime_type: parsed_doc.mime_type,
        size: file_size,
        chunk_count: raw_chunks.len(),
        created_at: now,
    };

    let mut stored_chunks = Vec::with_capacity(raw_chunks.len());
    for (i, rc) in raw_chunks.into_iter().enumerate() {
        let emb = embeddings.get(i).cloned().unwrap_or_default();
        stored_chunks.push(StoredChunk {
            id: uuid::Uuid::new_v4().to_string(),
            collection_id: collection_id.clone(),
            document_id: doc_id.clone(),
            chunk_index: rc.chunk_index,
            content: rc.content,
            page_number: rc.page_number,
            metadata_json: rc.metadata_json,
            embedding: emb,
        });
    }

    storage::insert_document_and_chunks(&mut conn, &doc, &stored_chunks)?;
    Ok(doc)
}

#[tauri::command]
pub async fn rag_index_text(
    app: AppHandle,
    collection_id: String,
    title: String,
    content: String,
    provider_config: Option<EmbeddingProvider>,
) -> Result<KnowledgeDocument, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let mut conn = manager.get_connection()?;

    let collection = storage::get_collection(&conn, &collection_id)?
        .ok_or_else(|| AppError::RagError("Collection not found".to_string()))?;

    let parsed_doc = parser::extract_from_raw_text(title, content.clone(), None);

    let raw_chunks =
        chunker::chunk_document(&parsed_doc, collection.chunk_size, collection.chunk_overlap);

    let provider = provider_config.unwrap_or_else(|| EmbeddingProvider::Ollama {
        endpoint: "http://localhost:11434".to_string(),
        model: collection.embedding_model.clone(),
    });

    let chunk_texts: Vec<String> = raw_chunks.iter().map(|c| c.content.clone()).collect();
    let embeddings = generate_embeddings(&manager.client, &provider, &chunk_texts).await?;

    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let doc = KnowledgeDocument {
        id: doc_id.clone(),
        collection_id: collection_id.clone(),
        name: parsed_doc.title,
        path: None,
        mime_type: parsed_doc.mime_type,
        size: content.len(),
        chunk_count: raw_chunks.len(),
        created_at: now,
    };

    let mut stored_chunks = Vec::with_capacity(raw_chunks.len());
    for (i, rc) in raw_chunks.into_iter().enumerate() {
        let emb = embeddings.get(i).cloned().unwrap_or_default();
        stored_chunks.push(StoredChunk {
            id: uuid::Uuid::new_v4().to_string(),
            collection_id: collection_id.clone(),
            document_id: doc_id.clone(),
            chunk_index: rc.chunk_index,
            content: rc.content,
            page_number: rc.page_number,
            metadata_json: rc.metadata_json,
            embedding: emb,
        });
    }

    storage::insert_document_and_chunks(&mut conn, &doc, &stored_chunks)?;
    Ok(doc)
}

#[tauri::command]
pub async fn rag_delete_document(app: AppHandle, document_id: String) -> Result<(), AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let mut conn = manager.get_connection()?;

    storage::delete_document(&mut conn, &document_id)
}

#[tauri::command]
pub async fn rag_list_documents(
    app: AppHandle,
    collection_id: String,
) -> Result<Vec<KnowledgeDocument>, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    storage::list_documents(&conn, &collection_id)
}

#[tauri::command]
pub async fn rag_search(
    app: AppHandle,
    collection_id: String,
    query: String,
    top_k: Option<usize>,
    min_score: Option<f32>,
    provider_config: Option<EmbeddingProvider>,
) -> Result<Vec<SearchResultChunk>, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    let collection = storage::get_collection(&conn, &collection_id)?
        .ok_or_else(|| AppError::RagError("Collection not found".to_string()))?;

    let provider = provider_config.unwrap_or_else(|| EmbeddingProvider::Ollama {
        endpoint: "http://localhost:11434".to_string(),
        model: collection.embedding_model.clone(),
    });

    let query_embeddings =
        generate_embeddings(&manager.client, &provider, &[query.clone()]).await?;
    let query_vector = query_embeddings.first().map(|v| v.as_slice());

    retrieval::hybrid_search(
        &conn,
        &collection_id,
        &query,
        query_vector,
        top_k.unwrap_or(5),
        min_score.unwrap_or(0.0),
    )
}

#[tauri::command]
pub async fn rag_get_stats(app: AppHandle) -> Result<RagStats, AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    storage::get_stats(&conn, &manager.db_path)
}

#[tauri::command]
pub async fn rag_clear_all(app: AppHandle) -> Result<(), AppError> {
    let app_dir = get_app_data_dir(&app)?;
    let manager = RagManager::new(&app_dir)?;
    let conn = manager.get_connection()?;

    conn.execute_batch(
        r#"
        DELETE FROM chunks_fts;
        DELETE FROM chunks;
        DELETE FROM documents;
        DELETE FROM collections;
        VACUUM;
        "#,
    )
    .map_err(|e| AppError::RagError(format!("Failed to clear RAG database: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rag_sqlite_lifecycle_and_hybrid_search() {
        let unique_id = uuid::Uuid::new_v4().to_string();
        let temp_dir = std::env::temp_dir().join(format!("sythoria_rag_test_{}", unique_id));
        let _ = std::fs::create_dir_all(&temp_dir);

        let manager = RagManager::new(&temp_dir).unwrap();
        let mut conn = manager.get_connection().unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 1. Create collection
        let col = KnowledgeCollection {
            id: format!("col_{}", unique_id),
            name: "Rust Guides".to_string(),
            description: Some("Guides on Rust programming".to_string()),
            embedding_provider: "ollama".to_string(),
            embedding_model: "nomic-embed-text".to_string(),
            chunk_size: 800,
            chunk_overlap: 150,
            document_count: 0,
            chunk_count: 0,
            created_at: now,
            updated_at: now,
        };

        storage::create_collection(&conn, &col).unwrap();

        let fetched_col = storage::get_collection(&conn, &col.id).unwrap().unwrap();
        assert_eq!(fetched_col.name, "Rust Guides");

        // 2. Insert document and chunks
        let doc = KnowledgeDocument {
            id: format!("doc_{}", unique_id),
            collection_id: col.id.clone(),
            name: "ownership.md".to_string(),
            path: None,
            mime_type: "text/markdown".to_string(),
            size: 1024,
            chunk_count: 2,
            created_at: now,
        };

        let dummy_vec: Vec<f32> = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        let chunks = vec![
            storage::StoredChunk {
                id: format!("chunk_1_{}", unique_id),
                document_id: doc.id.clone(),
                collection_id: col.id.clone(),
                chunk_index: 0,
                content: "Rust uses an affine type system with strict ownership rules to guarantee memory safety.".to_string(),
                page_number: Some(1),
                metadata_json: "{}".to_string(),
                embedding: dummy_vec.clone(),
            },
            storage::StoredChunk {
                id: format!("chunk_2_{}", unique_id),
                document_id: doc.id.clone(),
                collection_id: col.id.clone(),
                chunk_index: 1,
                content: "Borrowing in Rust allows shared references or unique mutable references without data races.".to_string(),
                page_number: Some(1),
                metadata_json: "{}".to_string(),
                embedding: dummy_vec.clone(),
            },
        ];

        storage::insert_document_and_chunks(&mut conn, &doc, &chunks).unwrap();

        // 3. Test Hybrid Search with lexical BM25 match
        let query_vector: Vec<f32> = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        let search_results = retrieval::hybrid_search(
            &conn,
            &col.id,
            "ownership memory safety",
            Some(&query_vector),
            5,
            0.0,
        )
        .unwrap();

        assert!(!search_results.is_empty());
        assert_eq!(search_results[0].document_name, "ownership.md");
        assert!(search_results[0].content.contains("strict ownership rules"));
        assert!(search_results[0].similarity_score > 0.0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_chunker_sliding_window_overlap() {
        let full_text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        let parsed = parser::ParsedDocument {
            title: "Test Fox".to_string(),
            full_text,
            mime_type: "text/plain".to_string(),
            metadata: std::collections::HashMap::new(),
            pages: vec![],
        };

        let chunks = chunker::chunk_document(&parsed, 100, 20);
        assert!(chunks.len() > 1);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[1].chunk_index, 1);
    }

    #[test]
    fn test_embedding_blob_roundtrip() {
        let original: Vec<f32> = vec![0.123, -0.456, 0.789, 1.0, -1.0, 0.0];
        let blob = embeddings::embedding_to_blob(&original);
        let recovered = embeddings::blob_to_embedding(&blob);

        assert_eq!(original.len(), recovered.len());
        for (a, b) in original.iter().zip(recovered.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
}
