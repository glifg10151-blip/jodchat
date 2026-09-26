use crate::AppError;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct PageContent {
    pub page_number: usize,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ParsedDocument {
    pub title: String,
    pub mime_type: String,
    pub full_text: String,
    pub pages: Vec<PageContent>,
    #[allow(dead_code)]
    pub metadata: HashMap<String, String>,
}

pub fn extract_document(path: &Path) -> Result<ParsedDocument, AppError> {
    if !path.exists() {
        return Err(AppError::AppPath(format!(
            "Document file not found: {}",
            path.display()
        )));
    }

    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled Document".to_string());

    let extension = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut metadata = HashMap::new();
    metadata.insert("file_name".to_string(), file_name.clone());
    metadata.insert("file_path".to_string(), path.to_string_lossy().into_owned());

    match extension.as_str() {
        "pdf" => parse_pdf(path, &file_name, metadata),
        "csv" | "tsv" => parse_delimited(path, &file_name, &extension, metadata),
        _ => parse_text_file(path, &file_name, &extension, metadata),
    }
}

pub fn extract_from_raw_text(
    title: String,
    text: String,
    metadata_map: Option<HashMap<String, String>>,
) -> ParsedDocument {
    let mut metadata = metadata_map.unwrap_or_default();
    metadata.insert("file_name".to_string(), title.clone());

    ParsedDocument {
        title,
        mime_type: "text/plain".to_string(),
        full_text: text.clone(),
        pages: vec![PageContent {
            page_number: 1,
            text,
        }],
        metadata,
    }
}

fn parse_pdf(
    path: &Path,
    title: &str,
    mut metadata: HashMap<String, String>,
) -> Result<ParsedDocument, AppError> {
    let bytes = fs::read(path).map_err(|e| {
        AppError::AppPath(format!("Failed to read PDF file {}: {}", path.display(), e))
    })?;

    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| {
        AppError::RagError(format!(
            "Failed to parse PDF text from {}: {}",
            path.display(),
            e
        ))
    })?;

    if text.trim().is_empty() {
        return Err(AppError::RagError(format!(
            "No extractable text found in PDF: {}",
            path.display()
        )));
    }

    metadata.insert("format".to_string(), "pdf".to_string());
    let normalized = normalize_text(&text);

    let raw_pages: Vec<&str> = text.split('\x0C').collect();
    let pages = if raw_pages.len() > 1 {
        raw_pages
            .into_iter()
            .enumerate()
            .map(|(idx, p)| PageContent {
                page_number: idx + 1,
                text: normalize_text(p),
            })
            .collect()
    } else {
        vec![PageContent {
            page_number: 1,
            text: normalized.clone(),
        }]
    };

    metadata.insert("page_count".to_string(), pages.len().to_string());

    Ok(ParsedDocument {
        title: title.to_string(),
        mime_type: "application/pdf".to_string(),
        full_text: normalized,
        pages,
        metadata,
    })
}

fn parse_delimited(
    path: &Path,
    title: &str,
    ext: &str,
    mut metadata: HashMap<String, String>,
) -> Result<ParsedDocument, AppError> {
    let content = fs::read_to_string(path).map_err(|e| {
        AppError::AppPath(format!(
            "Failed to read delimited file {}: {}",
            path.display(),
            e
        ))
    })?;

    metadata.insert("format".to_string(), ext.to_string());
    let normalized = normalize_text(&content);

    Ok(ParsedDocument {
        title: title.to_string(),
        mime_type: if ext == "csv" {
            "text/csv"
        } else {
            "text/tab-separated-values"
        }
        .to_string(),
        full_text: normalized.clone(),
        pages: vec![PageContent {
            page_number: 1,
            text: normalized,
        }],
        metadata,
    })
}

fn parse_text_file(
    path: &Path,
    title: &str,
    ext: &str,
    mut metadata: HashMap<String, String>,
) -> Result<ParsedDocument, AppError> {
    let bytes = fs::read(path)
        .map_err(|e| AppError::AppPath(format!("Failed to read file {}: {}", path.display(), e)))?;

    let content = String::from_utf8(bytes.clone())
        .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());

    metadata.insert("format".to_string(), ext.to_string());
    let normalized = normalize_text(&content);

    let mime_type = match ext {
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "cpp" | "c" | "java" => "text/x-code",
        _ => "text/plain",
    }
    .to_string();

    Ok(ParsedDocument {
        title: title.to_string(),
        mime_type,
        full_text: normalized.clone(),
        pages: vec![PageContent {
            page_number: 1,
            text: normalized,
        }],
        metadata,
    })
}

fn normalize_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut consecutive_newlines = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            consecutive_newlines += 1;
            if consecutive_newlines <= 2 {
                result.push('\n');
            }
        } else {
            consecutive_newlines = 0;
            if !result.is_empty() && !result.ends_with('\n') {
                result.push('\n');
            }
            result.push_str(trimmed);
        }
    }

    result
}
