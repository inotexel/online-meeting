use super::embeddings::{embed_query, embed_texts, EMBEDDING_DIM};
use super::neo4j::Neo4jClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

const CHUNK_SIZE: usize = 900;
const CHUNK_OVERLAP: usize = 120;
const VECTOR_INDEX: &str = "doc_chunk_embeddings";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestDocumentInput {
    pub client_id: String,
    pub client_name: String,
    pub file_path: String,
    pub openai_api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchClientDocsInput {
    pub client_id: String,
    pub query: String,
    pub openai_api_key: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDocumentSummary {
    pub id: String,
    pub client_id: String,
    pub title: String,
    pub filename: String,
    pub chunk_count: i64,
    pub uploaded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocChunkHit {
    pub chunk_id: String,
    pub document_id: String,
    pub document_title: String,
    pub text: String,
    pub score: f64,
}

pub fn extract_text_from_path(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" | "markdown" | "csv" => fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {e}", path.display())),
        "pdf" => extract_pdf_text(path),
        _ => Err(format!(
            "Unsupported file type '.{ext}'. Use .txt, .md, or .pdf"
        )),
    }
}

fn extract_pdf_text(path: &Path) -> Result<String, String> {
    pdf_extract::extract_text(path).map_err(|e| format!("PDF extract failed: {e}"))
}

pub fn chunk_text(text: &str) -> Vec<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Vec::new();
    }
    if normalized.len() <= CHUNK_SIZE {
        return vec![normalized];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    let chars: Vec<char> = normalized.chars().collect();
    let len = chars.len();

    while start < len {
        let mut end = (start + CHUNK_SIZE).min(len);
        if end < len {
            if let Some(rel) = chars[start..end]
                .iter()
                .rposition(|c| matches!(c, '.' | '!' | '?' | '\n'))
            {
                end = start + rel + 1;
            }
        }
        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            chunks.push(trimmed.to_string());
        }
        if end >= len {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }

    chunks
}

fn client_docs_dir(app: &AppHandle, client_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir unavailable: {e}"))?;
    Ok(base.join("client-docs").join(client_id))
}

pub async fn ensure_document_schema(neo: &Neo4jClient) -> Result<(), String> {
    neo.ensure_constraints().await?;

    let statements = [
        "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
        "CREATE CONSTRAINT doc_chunk_id IF NOT EXISTS FOR (c:DocChunk) REQUIRE c.id IS UNIQUE",
        &format!(
            "CREATE VECTOR INDEX {VECTOR_INDEX} IF NOT EXISTS FOR (c:DocChunk) ON (c.embedding) OPTIONS {{indexConfig: {{ `vector.dimensions`: {EMBEDDING_DIM}, `vector.similarity_function`: 'cosine' }}}}"
        ),
    ];

    for statement in statements {
        if let Err(err) = neo.run(statement, json!({})).await {
            if err.contains("already exists") || err.contains("Equivalent") {
                continue;
            }
            return Err(err);
        }
    }

    Ok(())
}

pub async fn ingest_document(
    app: &AppHandle,
    client_id: &str,
    client_name: &str,
    source_path: &str,
    openai_api_key: &str,
) -> Result<ClientDocumentSummary, String> {
    let neo = Neo4jClient::from_env()?;
    ensure_document_schema(&neo).await?;

    let path = PathBuf::from(source_path);
    if !path.is_file() {
        return Err(format!("File not found: {source_path}"));
    }

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document")
        .to_string();
    let title = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(&filename)
        .to_string();

    let text = extract_text_from_path(&path)?;
    let chunks = chunk_text(&text);
    if chunks.is_empty() {
        return Err("Document has no extractable text".to_string());
    }

    let document_id = format!("doc_{}", Uuid::new_v4());
    let dest_dir = client_docs_dir(app, client_id)?;
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create document folder: {e}"))?;
    let dest_path = dest_dir.join(format!("{document_id}_{filename}"));
    fs::copy(&path, &dest_path).map_err(|e| format!("Failed to store document copy: {e}"))?;

    neo.run(
        r#"
        MERGE (cl:Client {id: $clientId})
        SET cl.name = $clientName, cl.updated_at = datetime()
        MERGE (d:Document {id: $documentId})
        SET d.title = $title,
            d.filename = $filename,
            d.client_id = $clientId,
            d.storage_path = $storagePath,
            d.chunk_count = $chunkCount,
            d.uploaded_at = datetime()
        MERGE (cl)-[:HAS_DOCUMENT]->(d)
        "#,
        json!({
            "clientId": client_id,
            "clientName": client_name,
            "documentId": document_id,
            "title": title,
            "filename": filename,
            "storagePath": dest_path.to_string_lossy(),
            "chunkCount": chunks.len() as i64,
        }),
    )
    .await?;

    let embeddings = embed_texts(openai_api_key, &chunks).await?;

    for (index, (chunk_text, embedding)) in chunks.iter().zip(embeddings.iter()).enumerate() {
        let chunk_id = format!("{document_id}_chunk_{index}");
        neo.run(
            r#"
            MATCH (d:Document {id: $documentId})
            MERGE (c:DocChunk {id: $chunkId})
            SET c.client_id = $clientId,
                c.document_id = $documentId,
                c.document_title = $documentTitle,
                c.chunk_index = $chunkIndex,
                c.text = $text,
                c.embedding = $embedding
            MERGE (d)-[:HAS_CHUNK]->(c)
            "#,
            json!({
                "documentId": document_id,
                "chunkId": chunk_id,
                "clientId": client_id,
                "documentTitle": title,
                "chunkIndex": index as i64,
                "text": chunk_text,
                "embedding": embedding,
            }),
        )
        .await?;
    }

    Ok(ClientDocumentSummary {
        id: document_id,
        client_id: client_id.to_string(),
        title,
        filename,
        chunk_count: chunks.len() as i64,
        uploaded_at: None,
    })
}

pub async fn list_documents(client_id: &str) -> Result<Vec<ClientDocumentSummary>, String> {
    let neo = Neo4jClient::from_env()?;
    let data = neo
        .run(
            r#"
            MATCH (cl:Client {id: $clientId})-[:HAS_DOCUMENT]->(d:Document)
            RETURN d.id, d.title, d.filename, d.chunk_count, toString(d.uploaded_at)
            ORDER BY d.uploaded_at DESC
            "#,
            json!({ "clientId": client_id }),
        )
        .await?;

    parse_document_rows(client_id, data)
}

pub async fn delete_document(app: &AppHandle, document_id: &str) -> Result<(), String> {
    let neo = Neo4jClient::from_env()?;

    let data = neo
        .run(
            r#"
            MATCH (d:Document {id: $documentId})
            RETURN d.storage_path AS storagePath
            "#,
            json!({ "documentId": document_id }),
        )
        .await?;

    if let Some(storage_path) = parse_optional_string(&data, 0) {
        let path = PathBuf::from(storage_path);
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
    }

    neo.run(
        r#"
        MATCH (d:Document {id: $documentId})
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:DocChunk)
        DETACH DELETE c, d
        "#,
        json!({ "documentId": document_id }),
    )
    .await?;

    let _ = app;
    Ok(())
}

pub async fn search_client_documents(
    client_id: &str,
    query: &str,
    openai_api_key: &str,
    limit: usize,
) -> Result<Vec<DocChunkHit>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let neo = Neo4jClient::from_env()?;
    ensure_document_schema(&neo).await?;

    let query_vector = embed_query(openai_api_key, trimmed).await?;
    let top_k = (limit * 4).max(12);
    let min_score = 0.75_f64;

    let data = neo
        .run(
            r#"
            CALL db.index.vector.queryNodes($indexName, $topK, $queryVector)
            YIELD node, score
            WHERE node.client_id = $clientId AND score >= $minScore
            RETURN node.id AS chunkId,
                   node.document_id AS documentId,
                   node.document_title AS documentTitle,
                   node.text AS text,
                   score
            ORDER BY score DESC
            LIMIT $limit
            "#,
            json!({
                "indexName": VECTOR_INDEX,
                "topK": top_k,
                "queryVector": query_vector,
                "clientId": client_id,
                "minScore": min_score,
                "limit": limit as i64,
            }),
        )
        .await?;

    parse_chunk_hits(data)
}

fn parse_document_rows(client_id: &str, data: Value) -> Result<Vec<ClientDocumentSummary>, String> {
    let rows = data
        .get("values")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No documents returned".to_string())?;

    Ok(rows
        .iter()
        .filter_map(|row| row.as_array())
        .map(|row| ClientDocumentSummary {
            id: row.first().and_then(|v| v.as_str()).unwrap_or("").to_string(),
            client_id: client_id.to_string(),
            title: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            filename: row.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            chunk_count: row.get(3).and_then(|v| v.as_i64()).unwrap_or(0),
            uploaded_at: row.get(4).and_then(|v| v.as_str()).map(|s| s.to_string()),
        })
        .filter(|doc| !doc.id.is_empty())
        .collect())
}

fn parse_chunk_hits(data: Value) -> Result<Vec<DocChunkHit>, String> {
    let rows = data
        .get("values")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No chunk search results".to_string())?;

    Ok(rows
        .iter()
        .filter_map(|row| row.as_array())
        .map(|row| DocChunkHit {
            chunk_id: row.first().and_then(|v| v.as_str()).unwrap_or("").to_string(),
            document_id: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            document_title: row.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            text: row.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            score: row.get(4).and_then(|v| v.as_f64()).unwrap_or(0.0),
        })
        .filter(|hit| !hit.text.is_empty())
        .collect())
}

fn parse_optional_string(data: &Value, column: usize) -> Option<String> {
    data.get("values")?
        .as_array()?
        .first()?
        .as_array()?
        .get(column)?
        .as_str()
        .map(|s| s.to_string())
}
