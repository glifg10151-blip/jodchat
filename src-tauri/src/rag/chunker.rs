use super::parser::ParsedDocument;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub chunk_index: usize,
    pub content: String,
    pub page_number: Option<usize>,
    pub char_start: usize,
    pub char_end: usize,
    pub metadata_json: String,
}

pub fn chunk_document(
    doc: &ParsedDocument,
    chunk_size: usize,
    chunk_overlap: usize,
) -> Vec<DocumentChunk> {
    let target_size = if chunk_size < 100 { 800 } else { chunk_size };
    let overlap = if chunk_overlap >= target_size {
        target_size / 4
    } else {
        chunk_overlap
    };

    let mut chunks = Vec::new();
    let mut current_chunk_idx = 0;

    for page in &doc.pages {
        let page_chunks = chunk_text(
            &page.text,
            target_size,
            overlap,
            Some(page.page_number),
            &mut current_chunk_idx,
            &doc.title,
        );
        chunks.extend(page_chunks);
    }

    if chunks.is_empty() && !doc.full_text.trim().is_empty() {
        let fallback = chunk_text(
            &doc.full_text,
            target_size,
            overlap,
            None,
            &mut current_chunk_idx,
            &doc.title,
        );
        chunks.extend(fallback);
    }

    chunks
}

fn chunk_text(
    text: &str,
    target_size: usize,
    overlap: usize,
    page_number: Option<usize>,
    chunk_counter: &mut usize,
    doc_title: &str,
) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return chunks;
    }

    if trimmed.len() <= target_size {
        let meta = serde_json::json!({
            "doc_title": doc_title,
            "page_number": page_number,
            "chunk_index": *chunk_counter,
        });

        chunks.push(DocumentChunk {
            chunk_index: *chunk_counter,
            content: trimmed.to_string(),
            page_number,
            char_start: 0,
            char_end: trimmed.len(),
            metadata_json: meta.to_string(),
        });
        *chunk_counter += 1;
        return chunks;
    }

    // Split paragraphs
    let paragraphs: Vec<&str> = trimmed.split("\n\n").collect();
    let mut current_buffer = String::new();
    let mut current_start = 0;

    for paragraph in paragraphs {
        let p_trimmed = paragraph.trim();
        if p_trimmed.is_empty() {
            continue;
        }

        if current_buffer.len() + p_trimmed.len() + 2 <= target_size {
            if !current_buffer.is_empty() {
                current_buffer.push_str("\n\n");
            }
            current_buffer.push_str(p_trimmed);
        } else {
            // Buffer is full or paragraph is larger than target_size
            if !current_buffer.is_empty() {
                let char_end = current_start + current_buffer.len();
                let meta = serde_json::json!({
                    "doc_title": doc_title,
                    "page_number": page_number,
                    "chunk_index": *chunk_counter,
                });

                chunks.push(DocumentChunk {
                    chunk_index: *chunk_counter,
                    content: current_buffer.clone(),
                    page_number,
                    char_start: current_start,
                    char_end,
                    metadata_json: meta.to_string(),
                });
                *chunk_counter += 1;

                // Carry over overlap
                let overlap_len = current_buffer.len().min(overlap);
                let carry_start = current_buffer.len() - overlap_len;
                let overlap_text = &current_buffer[carry_start..];
                current_buffer = overlap_text.trim().to_string();
                current_start = char_end - current_buffer.len();
            }

            // If a single paragraph is larger than target_size, split by sentences or lines
            if p_trimmed.len() > target_size {
                let sub_chunks = split_large_block(p_trimmed, target_size, overlap);
                for sub in sub_chunks {
                    let char_end = current_start + sub.len();
                    let meta = serde_json::json!({
                        "doc_title": doc_title,
                        "page_number": page_number,
                        "chunk_index": *chunk_counter,
                    });

                    chunks.push(DocumentChunk {
                        chunk_index: *chunk_counter,
                        content: sub.clone(),
                        page_number,
                        char_start: current_start,
                        char_end,
                        metadata_json: meta.to_string(),
                    });
                    *chunk_counter += 1;
                    current_start = char_end;
                }
                current_buffer.clear();
            } else {
                if !current_buffer.is_empty() {
                    current_buffer.push_str("\n\n");
                }
                current_buffer.push_str(p_trimmed);
            }
        }
    }

    if !current_buffer.trim().is_empty() {
        let char_end = current_start + current_buffer.len();
        let meta = serde_json::json!({
            "doc_title": doc_title,
            "page_number": page_number,
            "chunk_index": *chunk_counter,
        });

        chunks.push(DocumentChunk {
            chunk_index: *chunk_counter,
            content: current_buffer.trim().to_string(),
            page_number,
            char_start: current_start,
            char_end,
            metadata_json: meta.to_string(),
        });
        *chunk_counter += 1;
    }

    chunks
}

fn split_large_block(text: &str, target_size: usize, overlap: usize) -> Vec<String> {
    let mut result = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0;

    while start < chars.len() {
        let mut end = (start + target_size).min(chars.len());
        if end < chars.len() {
            // Find a sentence or word boundary backwards
            let mut break_pos = None;
            for i in (start..end).rev() {
                if chars[i] == '.' || chars[i] == '?' || chars[i] == '!' || chars[i] == '\n' {
                    break_pos = Some(i + 1);
                    break;
                }
            }
            if break_pos.is_none() {
                for i in (start..end).rev() {
                    if chars[i] == ' ' {
                        break_pos = Some(i + 1);
                        break;
                    }
                }
            }
            if let Some(pos) = break_pos {
                if pos > start + 50 {
                    end = pos;
                }
            }
        }

        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            result.push(trimmed.to_string());
        }

        if end >= chars.len() {
            break;
        }

        start = end.saturating_sub(overlap);
    }

    result
}
