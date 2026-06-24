use super::documents::{
    self, ClientDocumentSummary, DocChunkHit, IngestDocumentInput, SearchClientDocsInput,
};
use super::neo4j::{ClientContext, Neo4jClient};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMeetingGraphInput {
    pub client_id: String,
    pub client_name: String,
    pub meeting_id: String,
    pub meeting_number: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendUtteranceInput {
    pub meeting_id: String,
    pub utterance_id: String,
    pub text: String,
    pub speaker_label: Option<String>,
    pub sequence_num: i64,
}

#[derive(Debug, Deserialize)]
pub struct MemoryTextItem {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryExtractionInput {
    pub client_id: String,
    pub meeting_id: String,
    #[serde(default)]
    pub new_facts: Vec<MemoryTextItem>,
    #[serde(default)]
    pub new_objections: Vec<MemoryTextItem>,
    #[serde(default)]
    pub new_questions: Vec<MemoryTextItem>,
    #[serde(default)]
    pub new_action_items: Vec<MemoryTextItem>,
    #[serde(default)]
    pub updated_objections: Vec<MemoryTextItem>,
}

fn client() -> Result<Neo4jClient, String> {
    Neo4jClient::from_env()
}

#[tauri::command]
pub fn knowledge_is_configured() -> bool {
    Neo4jClient::is_configured()
}

#[tauri::command]
pub async fn knowledge_test_connection() -> Result<String, String> {
    let neo = client()?;
    neo.run("RETURN 1 AS ok", json!({})).await?;
    neo.ensure_constraints().await?;
    documents::ensure_document_schema(&neo).await?;
    Ok("Neo4j connection successful".to_string())
}

#[tauri::command]
pub async fn knowledge_start_meeting_graph(input: StartMeetingGraphInput) -> Result<(), String> {
    let neo = client()?;
    neo.ensure_constraints().await?;

    let meeting_number = input.meeting_number.unwrap_or(1);

    neo.run(
        r#"
        MERGE (c:Client {id: $clientId})
        SET c.name = $clientName, c.updated_at = datetime()
        MERGE (m:Meeting {id: $meetingId})
        SET m.number = $meetingNumber,
            m.started_at = coalesce(m.started_at, datetime()),
            m.status = 'in_progress'
        MERGE (c)-[:HAS_MEETING]->(m)
        "#,
        json!({
            "clientId": input.client_id,
            "clientName": input.client_name,
            "meetingId": input.meeting_id,
            "meetingNumber": meeting_number,
        }),
    )
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn knowledge_end_meeting_graph(
    meeting_id: String,
    summary: Option<String>,
) -> Result<(), String> {
    let neo = client()?;
    neo.run(
        r#"
        MATCH (m:Meeting {id: $meetingId})
        SET m.ended_at = datetime(),
            m.status = 'completed',
            m.summary = coalesce($summary, m.summary)
        "#,
        json!({
            "meetingId": meeting_id,
            "summary": summary,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn knowledge_append_utterance(input: AppendUtteranceInput) -> Result<(), String> {
    let neo = client()?;
    neo.run(
        r#"
        MATCH (m:Meeting {id: $meetingId})
        MERGE (u:Utterance {id: $utteranceId})
        SET u.text = $text,
            u.speaker_label = $speakerLabel,
            u.sequence_num = $sequenceNum,
            u.created_at = datetime()
        MERGE (m)-[:HAS_UTTERANCE]->(u)
        "#,
        json!({
            "meetingId": input.meeting_id,
            "utteranceId": input.utterance_id,
            "text": input.text,
            "speakerLabel": input.speaker_label,
            "sequenceNum": input.sequence_num,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn knowledge_apply_memory(input: MemoryExtractionInput) -> Result<(), String> {
    let neo = client()?;

    for fact in &input.new_facts {
        neo.run(
            r#"
            MATCH (c:Client {id: $clientId}), (m:Meeting {id: $meetingId})
            MERGE (f:Fact {id: $id})
            SET f.text = $text, f.updated_at = datetime()
            MERGE (c)-[:HAS_FACT]->(f)
            MERGE (m)-[:MENTIONED]->(f)
            "#,
            json!({
                "clientId": input.client_id,
                "meetingId": input.meeting_id,
                "id": fact.id,
                "text": fact.text,
            }),
        )
        .await?;
    }

    for objection in &input.new_objections {
        let status = objection.status.as_deref().unwrap_or("open");
        neo.run(
            r#"
            MATCH (m:Meeting {id: $meetingId})
            MERGE (o:Objection {id: $id})
            SET o.text = $text, o.status = $status, o.updated_at = datetime()
            MERGE (m)-[:RAISED]->(o)
            "#,
            json!({
                "meetingId": input.meeting_id,
                "id": objection.id,
                "text": objection.text,
                "status": status,
            }),
        )
        .await?;
    }

    for objection in &input.updated_objections {
        if let Some(status) = &objection.status {
            neo.run(
                r#"
                MATCH (o:Objection {id: $id})
                SET o.status = $status, o.updated_at = datetime()
                "#,
                json!({
                    "id": objection.id,
                    "status": status,
                }),
            )
            .await?;
        }
    }

    for question in &input.new_questions {
        let status = question.status.as_deref().unwrap_or("open");
        neo.run(
            r#"
            MATCH (m:Meeting {id: $meetingId})
            MERGE (q:Question {id: $id})
            SET q.text = $text, q.status = $status, q.updated_at = datetime()
            MERGE (m)-[:MENTIONED]->(q)
            "#,
            json!({
                "meetingId": input.meeting_id,
                "id": question.id,
                "text": question.text,
                "status": status,
            }),
        )
        .await?;
    }

    for action in &input.new_action_items {
        let status = action.status.as_deref().unwrap_or("open");
        neo.run(
            r#"
            MATCH (m:Meeting {id: $meetingId})
            MERGE (a:ActionItem {id: $id})
            SET a.text = $text, a.status = $status, a.updated_at = datetime()
            MERGE (m)-[:CREATED]->(a)
            "#,
            json!({
                "meetingId": input.meeting_id,
                "id": action.id,
                "text": action.text,
                "status": status,
            }),
        )
        .await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn knowledge_get_client_context(client_id: String) -> Result<ClientContext, String> {
    let neo = client()?;
    let data = neo
        .run(
            r#"
            OPTIONAL MATCH (c:Client {id: $clientId})
            OPTIONAL MATCH (c)-[:HAS_FACT]->(f:Fact)
            OPTIONAL MATCH (c)-[:HAS_MEETING]->(m:Meeting)
            OPTIONAL MATCH (m)-[:RAISED]->(o:Objection {status: 'open'})
            OPTIONAL MATCH (m)-[:MENTIONED]->(q:Question {status: 'open'})
            OPTIONAL MATCH (m)-[:CREATED]->(a:ActionItem {status: 'open'})
            RETURN coalesce(c.name, $clientId) AS clientName,
                   count(DISTINCT m) AS meetingCount,
                   [x IN collect(DISTINCT f.text) WHERE x IS NOT NULL] AS facts,
                   [x IN collect(DISTINCT o.text) WHERE x IS NOT NULL] AS openObjections,
                   [x IN collect(DISTINCT q.text) WHERE x IS NOT NULL] AS openQuestions,
                   [x IN collect(DISTINCT a.text) WHERE x IS NOT NULL] AS openActions
            "#,
            json!({ "clientId": client_id }),
        )
        .await?;

    parse_client_context(&client_id, data)
}

fn parse_client_context(client_id: &str, data: Value) -> Result<ClientContext, String> {
    let values = data
        .get("values")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .ok_or_else(|| "No context returned from Neo4j".to_string())?;

    let client_name = values
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("Client")
        .to_string();
    let meeting_count = values.get(1).and_then(|v| v.as_i64()).unwrap_or(0);

    Ok(ClientContext {
        client_id: client_id.to_string(),
        client_name,
        meeting_count,
        facts: string_list(values.get(2)),
        open_objections: string_list(values.get(3)),
        open_questions: string_list(values.get(4)),
        open_actions: string_list(values.get(5)),
    })
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn knowledge_ingest_document(
    app: tauri::AppHandle,
    input: IngestDocumentInput,
) -> Result<ClientDocumentSummary, String> {
    documents::ingest_document(
        &app,
        &input.client_id,
        &input.client_name,
        &input.file_path,
        &input.openai_api_key,
    )
    .await
}

#[tauri::command]
pub async fn knowledge_list_documents(
    client_id: String,
) -> Result<Vec<ClientDocumentSummary>, String> {
    documents::list_documents(&client_id).await
}

#[tauri::command]
pub async fn knowledge_delete_document(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<(), String> {
    documents::delete_document(&app, &document_id).await
}

#[tauri::command]
pub async fn knowledge_search_client_docs(
    input: SearchClientDocsInput,
) -> Result<Vec<DocChunkHit>, String> {
    documents::search_client_documents(
        &input.client_id,
        &input.query,
        &input.openai_api_key,
        input.limit.unwrap_or(5) as usize,
    )
    .await
}
