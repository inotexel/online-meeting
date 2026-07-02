use serde::Deserialize;

pub const EMBEDDING_MODEL: &str = "text-embedding-3-small";
pub const EMBEDDING_DIM: usize = 1536;

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

pub async fn embed_texts(api_key: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/embeddings")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": EMBEDDING_MODEL,
            "input": texts,
        }))
        .send()
        .await
        .map_err(|e| format!("Embedding request failed: {e}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());

    if !status.is_success() {
        return Err(format!("OpenAI embeddings error ({status}): {body_text}"));
    }

    let parsed: EmbeddingsResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Invalid embeddings response: {e}"))?;

    let vectors: Vec<Vec<f32>> = parsed
        .data
        .into_iter()
        .map(|row| row.embedding)
        .collect();

    for vector in &vectors {
        if vector.len() != EMBEDDING_DIM {
            return Err(format!(
                "Unexpected embedding dimension {} (expected {EMBEDDING_DIM})",
                vector.len()
            ));
        }
    }

    if vectors.len() != texts.len() {
        return Err("Embedding count mismatch".to_string());
    }

    Ok(vectors)
}

pub async fn embed_query(api_key: &str, text: &str) -> Result<Vec<f32>, String> {
    let mut vectors = embed_texts(api_key, &[text.to_string()]).await?;
    vectors
        .pop()
        .ok_or_else(|| "No embedding returned".to_string())
}
