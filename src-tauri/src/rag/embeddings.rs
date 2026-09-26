use crate::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EmbeddingProvider {
    Ollama {
        endpoint: String,
        model: String,
    },
    Openai {
        endpoint: String,
        api_key: String,
        model: String,
    },
    Gemini {
        api_key: String,
        model: String,
    },
    Custom {
        endpoint: String,
        api_key: Option<String>,
        model: String,
    },
    LexicalOnly,
}

impl Default for EmbeddingProvider {
    fn default() -> Self {
        Self::Ollama {
            endpoint: "http://localhost:11434".to_string(),
            model: "nomic-embed-text".to_string(),
        }
    }
}

pub fn embedding_to_blob(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for val in vec {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

pub fn blob_to_embedding(bytes: &[u8]) -> Vec<f32> {
    let mut vec = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let val = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        vec.push(val);
    }
    vec
}

pub async fn generate_embeddings(
    client: &reqwest::Client,
    provider: &EmbeddingProvider,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    match provider {
        EmbeddingProvider::Ollama { endpoint, model } => {
            embed_ollama(client, endpoint, model, texts).await
        }
        EmbeddingProvider::Openai {
            endpoint,
            api_key,
            model,
        } => embed_openai(client, endpoint, api_key, model, texts).await,
        EmbeddingProvider::Gemini { api_key, model } => {
            embed_gemini(client, api_key, model, texts).await
        }
        EmbeddingProvider::Custom {
            endpoint,
            api_key,
            model,
        } => {
            let key = api_key.as_deref().unwrap_or_default();
            embed_openai(client, endpoint, key, model, texts).await
        }
        EmbeddingProvider::LexicalOnly => Ok(texts.iter().map(|_| Vec::new()).collect()),
    }
}

async fn embed_ollama(
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AppError> {
    let base = endpoint.trim_end_matches('/');
    let url = format!("{}/api/embed", base);

    let body = serde_json::json!({
        "model": model,
        "input": texts,
    });

    let resp =
        client.post(&url).json(&body).send().await.map_err(|e| {
            AppError::RequestFailed(format!("Ollama embed connection error: {}", e))
        })?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AppError::RagError(format!(
            "Ollama embed API error: {}",
            err_text
        )));
    }

    #[derive(Deserialize)]
    struct OllamaEmbedResponse {
        embeddings: Vec<Vec<f32>>,
    }

    let parsed: OllamaEmbedResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Ollama embeddings: {}", e)))?;

    Ok(parsed.embeddings)
}

async fn embed_openai(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AppError> {
    let base = endpoint.trim_end_matches('/');
    let url = if base.ends_with("/embeddings") {
        base.to_string()
    } else {
        format!("{}/embeddings", base)
    };

    let body = serde_json::json!({
        "model": model,
        "input": texts,
    });

    let mut req = client.post(&url).json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("OpenAI embed connection error: {}", e)))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AppError::RagError(format!(
            "OpenAI embed API error: {}",
            err_text
        )));
    }

    #[derive(Deserialize)]
    struct OpenAiDataItem {
        embedding: Vec<f32>,
        index: Option<usize>,
    }

    #[derive(Deserialize)]
    struct OpenAiEmbedResponse {
        data: Vec<OpenAiDataItem>,
    }

    let mut parsed: OpenAiEmbedResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse OpenAI embeddings: {}", e)))?;

    parsed.data.sort_by_key(|item| item.index.unwrap_or(0));

    Ok(parsed.data.into_iter().map(|d| d.embedding).collect())
}

async fn embed_gemini(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AppError> {
    let model_name = if model.starts_with("models/") {
        model.to_string()
    } else {
        format!("models/{}", model)
    };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:batchEmbedContents?key={}",
        model_name, api_key
    );

    let requests: Vec<serde_json::Value> = texts
        .iter()
        .map(|t| {
            serde_json::json!({
                "model": model_name,
                "content": {
                    "parts": [{ "text": t }]
                }
            })
        })
        .collect();

    let body = serde_json::json!({
        "requests": requests,
    });

    let resp =
        client.post(&url).json(&body).send().await.map_err(|e| {
            AppError::RequestFailed(format!("Gemini embed connection error: {}", e))
        })?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AppError::RagError(format!(
            "Gemini embed API error: {}",
            err_text
        )));
    }

    #[derive(Deserialize)]
    struct GeminiEmbedValues {
        values: Vec<f32>,
    }

    #[derive(Deserialize)]
    struct GeminiEmbedResponse {
        embeddings: Vec<GeminiEmbedValues>,
    }

    let parsed: GeminiEmbedResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Gemini embeddings: {}", e)))?;

    Ok(parsed.embeddings.into_iter().map(|e| e.values).collect())
}
