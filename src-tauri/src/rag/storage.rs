use crate::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeCollection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub embedding_provider: String,
    pub embedding_model: String,
    pub chunk_size: usize,
    pub chunk_overlap: usize,
    pub document_count: usize,
    pub chunk_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeDocument {
    pub id: String,
    pub collection_id: String,
    pub name: String,
    pub path: Option<String>,
    pub mime_type: String,
    pub size: usize,
    pub chunk_count: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredChunk {
    pub id: String,
    pub collection_id: String,
    pub document_id: String,
    pub chunk_index: usize,
    pub content: String,
    pub page_number: Option<usize>,
    pub metadata_json: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagStats {
    pub collection_count: usize,
    pub document_count: usize,
    pub chunk_count: usize,
    pub db_size_bytes: u64,
}

pub fn open_or_create_db(db_path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::AppPath(format!("Failed to create RAG database directory: {}", e))
        })?;
    }

    let conn = Connection::open(db_path)
        .map_err(|e| AppError::RagError(format!("Failed to open RAG SQLite database: {}", e)))?;

    // Enable WAL mode & foreign keys for performance and data integrity
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            embedding_provider TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            chunk_size INTEGER NOT NULL DEFAULT 800,
            chunk_overlap INTEGER NOT NULL DEFAULT 150,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            page_number INTEGER,
            metadata_json TEXT,
            embedding BLOB,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            chunk_id UNINDEXED,
            collection_id UNINDEXED,
            document_id UNINDEXED,
            content
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_collection ON chunks(collection_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);
        "#,
    )
    .map_err(|e| AppError::RagError(format!("Failed to initialize RAG schema: {}", e)))?;

    Ok(conn)
}

pub fn create_collection(
    conn: &Connection,
    collection: &KnowledgeCollection,
) -> Result<(), AppError> {
    conn.execute(
        r#"
        INSERT INTO collections (id, name, description, embedding_provider, embedding_model, chunk_size, chunk_overlap, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            collection.id,
            collection.name,
            collection.description,
            collection.embedding_provider,
            collection.embedding_model,
            collection.chunk_size as i64,
            collection.chunk_overlap as i64,
            collection.created_at,
            collection.updated_at,
        ],
    ).map_err(|e| AppError::RagError(format!("Failed to create collection: {}", e)))?;

    Ok(())
}

pub fn list_collections(conn: &Connection) -> Result<Vec<KnowledgeCollection>, AppError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.id, c.name, c.description, c.embedding_provider, c.embedding_model, c.chunk_size, c.chunk_overlap,
                   c.created_at, c.updated_at,
                   COUNT(DISTINCT d.id) as doc_count,
                   COUNT(k.id) as chunk_count
            FROM collections c
            LEFT JOIN documents d ON d.collection_id = c.id
            LEFT JOIN chunks k ON k.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
            "#,
        )
        .map_err(|e| AppError::RagError(format!("Failed to prepare list_collections: {}", e)))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(KnowledgeCollection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                embedding_provider: row.get(3)?,
                embedding_model: row.get(4)?,
                chunk_size: row.get::<_, i64>(5)? as usize,
                chunk_overlap: row.get::<_, i64>(6)? as usize,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                document_count: row.get::<_, i64>(9)? as usize,
                chunk_count: row.get::<_, i64>(10)? as usize,
            })
        })
        .map_err(|e| AppError::RagError(format!("Failed to execute list_collections: {}", e)))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(
            row.map_err(|e| AppError::RagError(format!("Failed to read collection row: {}", e)))?,
        );
    }
    Ok(result)
}

pub fn get_collection(
    conn: &Connection,
    id: &str,
) -> Result<Option<KnowledgeCollection>, AppError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.id, c.name, c.description, c.embedding_provider, c.embedding_model, c.chunk_size, c.chunk_overlap,
                   c.created_at, c.updated_at,
                   COUNT(DISTINCT d.id) as doc_count,
                   COUNT(k.id) as chunk_count
            FROM collections c
            LEFT JOIN documents d ON d.collection_id = c.id
            LEFT JOIN chunks k ON k.collection_id = c.id
            WHERE c.id = ?1
            GROUP BY c.id
            "#,
        )
        .map_err(|e| AppError::RagError(format!("Failed to prepare get_collection: {}", e)))?;

    let mut rows = stmt
        .query(params![id])
        .map_err(|e| AppError::RagError(format!("Failed to query collection: {}", e)))?;

    if let Some(row) = rows
        .next()
        .map_err(|e| AppError::RagError(format!("Failed to get collection row: {}", e)))?
    {
        Ok(Some(KnowledgeCollection {
            id: row.get(0).map_err(|e| AppError::RagError(e.to_string()))?,
            name: row.get(1).map_err(|e| AppError::RagError(e.to_string()))?,
            description: row.get(2).map_err(|e| AppError::RagError(e.to_string()))?,
            embedding_provider: row.get(3).map_err(|e| AppError::RagError(e.to_string()))?,
            embedding_model: row.get(4).map_err(|e| AppError::RagError(e.to_string()))?,
            chunk_size: row
                .get::<_, i64>(5)
                .map_err(|e| AppError::RagError(e.to_string()))? as usize,
            chunk_overlap: row
                .get::<_, i64>(6)
                .map_err(|e| AppError::RagError(e.to_string()))?
                as usize,
            created_at: row.get(7).map_err(|e| AppError::RagError(e.to_string()))?,
            updated_at: row.get(8).map_err(|e| AppError::RagError(e.to_string()))?,
            document_count: row
                .get::<_, i64>(9)
                .map_err(|e| AppError::RagError(e.to_string()))?
                as usize,
            chunk_count: row
                .get::<_, i64>(10)
                .map_err(|e| AppError::RagError(e.to_string()))? as usize,
        }))
    } else {
        Ok(None)
    }
}

pub fn delete_collection(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM chunks_fts WHERE collection_id = ?1",
        params![id],
    )
    .map_err(|e| AppError::RagError(format!("Failed to delete from chunks_fts: {}", e)))?;

    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(|e| AppError::RagError(format!("Failed to delete collection: {}", e)))?;

    Ok(())
}

pub fn insert_document_and_chunks(
    conn: &mut Connection,
    doc: &KnowledgeDocument,
    chunks: &[StoredChunk],
) -> Result<(), AppError> {
    let tx = conn
        .transaction()
        .map_err(|e| AppError::RagError(format!("Failed to begin transaction: {}", e)))?;

    tx.execute(
        r#"
        INSERT INTO documents (id, collection_id, name, path, mime_type, size, chunk_count, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            doc.id,
            doc.collection_id,
            doc.name,
            doc.path,
            doc.mime_type,
            doc.size as i64,
            chunks.len() as i64,
            doc.created_at,
        ],
    ).map_err(|e| AppError::RagError(format!("Failed to insert document: {}", e)))?;

    for chunk in chunks {
        let blob = super::embeddings::embedding_to_blob(&chunk.embedding);
        tx.execute(
            r#"
            INSERT INTO chunks (id, collection_id, document_id, chunk_index, content, page_number, metadata_json, embedding)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                chunk.id,
                chunk.collection_id,
                chunk.document_id,
                chunk.chunk_index as i64,
                chunk.content,
                chunk.page_number.map(|p| p as i64),
                chunk.metadata_json,
                blob,
            ],
        ).map_err(|e| AppError::RagError(format!("Failed to insert chunk: {}", e)))?;

        tx.execute(
            r#"
            INSERT INTO chunks_fts (chunk_id, collection_id, document_id, content)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![
                chunk.id,
                chunk.collection_id,
                chunk.document_id,
                chunk.content
            ],
        )
        .map_err(|e| AppError::RagError(format!("Failed to insert FTS chunk: {}", e)))?;
    }

    let now = chrono::Utc::now().timestamp_millis();
    tx.execute(
        "UPDATE collections SET updated_at = ?1 WHERE id = ?2",
        params![now, doc.collection_id],
    )
    .map_err(|e| AppError::RagError(format!("Failed to update collection time: {}", e)))?;

    tx.commit()
        .map_err(|e| AppError::RagError(format!("Failed to commit document insert: {}", e)))?;

    Ok(())
}

pub fn delete_document(conn: &mut Connection, doc_id: &str) -> Result<(), AppError> {
    let tx = conn
        .transaction()
        .map_err(|e| AppError::RagError(format!("Failed to begin transaction: {}", e)))?;

    tx.execute(
        "DELETE FROM chunks_fts WHERE document_id = ?1",
        params![doc_id],
    )
    .map_err(|e| AppError::RagError(format!("Failed to delete FTS entries: {}", e)))?;

    tx.execute("DELETE FROM documents WHERE id = ?1", params![doc_id])
        .map_err(|e| AppError::RagError(format!("Failed to delete document: {}", e)))?;

    tx.commit()
        .map_err(|e| AppError::RagError(format!("Failed to commit document deletion: {}", e)))?;

    Ok(())
}

pub fn list_documents(
    conn: &Connection,
    collection_id: &str,
) -> Result<Vec<KnowledgeDocument>, AppError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, collection_id, name, path, mime_type, size, chunk_count, created_at
            FROM documents
            WHERE collection_id = ?1
            ORDER BY created_at DESC
            "#,
        )
        .map_err(|e| AppError::RagError(format!("Failed to prepare list_documents: {}", e)))?;

    let rows = stmt
        .query_map(params![collection_id], |row| {
            Ok(KnowledgeDocument {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                mime_type: row.get(4)?,
                size: row.get::<_, i64>(5)? as usize,
                chunk_count: row.get::<_, i64>(6)? as usize,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| AppError::RagError(format!("Failed to query documents: {}", e)))?;

    let mut docs = Vec::new();
    for r in rows {
        docs.push(r.map_err(|e| AppError::RagError(e.to_string()))?);
    }
    Ok(docs)
}

pub fn get_stats(conn: &Connection, db_path: &Path) -> Result<RagStats, AppError> {
    let collection_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
        .unwrap_or(0);
    let document_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))
        .unwrap_or(0);
    let chunk_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))
        .unwrap_or(0);

    let db_size_bytes = std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);

    Ok(RagStats {
        collection_count: collection_count as usize,
        document_count: document_count as usize,
        chunk_count: chunk_count as usize,
        db_size_bytes,
    })
}
