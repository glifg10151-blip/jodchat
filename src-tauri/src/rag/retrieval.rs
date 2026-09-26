use crate::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub document_name: String,
    pub collection_id: String,
    pub chunk_index: usize,
    pub content: String,
    pub page_number: Option<usize>,
    pub similarity_score: f32,
    pub rrf_score: f32,
    pub metadata_json: String,
}

pub fn hybrid_search(
    conn: &Connection,
    collection_id: &str,
    query: &str,
    query_vector: Option<&[f32]>,
    top_k: usize,
    min_score: f32,
) -> Result<Vec<SearchResultChunk>, AppError> {
    let limit = if top_k == 0 { 5 } else { top_k.min(50) };

    // 1. Sparse Search via FTS5
    let sparse_results = search_fts(conn, collection_id, query, limit * 3)?;

    // 2. Dense Search via Vector Cosine Similarity
    let dense_results = if let Some(q_vec) = query_vector {
        if !q_vec.is_empty() {
            search_vectors(conn, collection_id, q_vec, limit * 3)?
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // 3. Reciprocal Rank Fusion (RRF)
    const RRF_K: f32 = 60.0;
    let mut chunk_map: HashMap<String, (SearchResultChunk, f32, f32)> = HashMap::new();

    // Add sparse ranks
    for (rank, mut chunk) in sparse_results.into_iter().enumerate() {
        let rrf_sparse = 1.0 / (RRF_K + rank as f32);
        let id = chunk.chunk_id.clone();
        chunk.rrf_score = rrf_sparse;
        chunk_map.insert(id, (chunk, 0.0, rrf_sparse));
    }

    // Add dense ranks
    for (rank, chunk) in dense_results.into_iter().enumerate() {
        let rrf_dense = 1.0 / (RRF_K + rank as f32);
        let id = chunk.chunk_id.clone();
        if let Some((existing, dense_score, _sparse_score)) = chunk_map.get_mut(&id) {
            *dense_score = chunk.similarity_score;
            existing.similarity_score = chunk.similarity_score;
            existing.rrf_score += rrf_dense;
        } else {
            let mut new_chunk = chunk;
            new_chunk.rrf_score = rrf_dense;
            let sim = new_chunk.similarity_score;
            chunk_map.insert(id, (new_chunk, sim, 0.0));
        }
    }

    let mut fused: Vec<SearchResultChunk> = chunk_map
        .into_values()
        .map(|(chunk, _, _)| chunk)
        .filter(|c| c.similarity_score >= min_score || c.rrf_score > 0.01)
        .collect();

    // Sort by RRF score descending
    fused.sort_by(|a, b| {
        b.rrf_score
            .partial_cmp(&a.rrf_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    fused.truncate(limit);

    Ok(fused)
}

fn search_fts(
    conn: &Connection,
    collection_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResultChunk>, AppError> {
    let sanitized_query: String = query
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();

    let tokens: Vec<&str> = sanitized_query.split_whitespace().collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let match_query = tokens
        .iter()
        .map(|t| format!("\"{}\"", t))
        .collect::<Vec<_>>()
        .join(" OR ");

    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.id, c.document_id, d.name, c.collection_id, c.chunk_index,
                   c.content, c.page_number, c.metadata_json, rank
            FROM chunks_fts f
            JOIN chunks c ON c.id = f.chunk_id
            JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ?1 AND c.collection_id = ?2
            ORDER BY rank
            LIMIT ?3
            "#,
        )
        .map_err(|e| AppError::RagError(format!("Failed to prepare FTS search: {}", e)))?;

    let rows = stmt
        .query_map(params![match_query, collection_id, limit as i64], |row| {
            let rank: f64 = row.get(8).unwrap_or(0.0);
            Ok(SearchResultChunk {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                document_name: row.get(2)?,
                collection_id: row.get(3)?,
                chunk_index: row.get::<_, i64>(4)? as usize,
                content: row.get(5)?,
                page_number: row.get::<_, Option<i64>>(6)?.map(|p| p as usize),
                metadata_json: row.get(7)?,
                similarity_score: 0.0,
                rrf_score: (-rank) as f32,
            })
        })
        .map_err(|e| AppError::RagError(format!("Failed to execute FTS search: {}", e)))?;

    let mut results = Vec::new();
    for r in rows {
        if let Ok(chunk) = r {
            results.push(chunk);
        }
    }
    Ok(results)
}

fn search_vectors(
    conn: &Connection,
    collection_id: &str,
    query_vector: &[f32],
    limit: usize,
) -> Result<Vec<SearchResultChunk>, AppError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT c.id, c.document_id, d.name, c.collection_id, c.chunk_index,
                   c.content, c.page_number, c.metadata_json, c.embedding
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE c.collection_id = ?1 AND c.embedding IS NOT NULL
            "#,
        )
        .map_err(|e| AppError::RagError(format!("Failed to prepare vector search: {}", e)))?;

    let rows = stmt
        .query_map(params![collection_id], |row| {
            let embedding_blob: Option<Vec<u8>> = row.get(8)?;
            let chunk = SearchResultChunk {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                document_name: row.get(2)?,
                collection_id: row.get(3)?,
                chunk_index: row.get::<_, i64>(4)? as usize,
                content: row.get(5)?,
                page_number: row.get::<_, Option<i64>>(6)?.map(|p| p as usize),
                metadata_json: row.get(7)?,
                similarity_score: 0.0,
                rrf_score: 0.0,
            };
            Ok((chunk, embedding_blob))
        })
        .map_err(|e| AppError::RagError(format!("Failed to query vector rows: {}", e)))?;

    let mut scored_chunks = Vec::new();
    for r in rows {
        if let Ok((mut chunk, blob)) = r {
            if let Some(bytes) = blob {
                let vec = super::embeddings::blob_to_embedding(&bytes);
                if vec.len() == query_vector.len() && !vec.is_empty() {
                    let sim = cosine_similarity(query_vector, &vec);
                    chunk.similarity_score = sim;
                    scored_chunks.push(chunk);
                }
            }
        }
    }

    scored_chunks.sort_by(|a, b| {
        b.similarity_score
            .partial_cmp(&a.similarity_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored_chunks.truncate(limit);

    Ok(scored_chunks)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    if norm_a <= 0.0 || norm_b <= 0.0 {
        0.0
    } else {
        dot / (norm_a.sqrt() * norm_b.sqrt())
    }
}
