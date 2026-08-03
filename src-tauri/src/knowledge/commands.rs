use super::documents::{
    self, ClientDocumentSummary, DocChunkHit, IngestDocumentInput, SearchClientDocsInput,
};
use super::neo4j::{ClientContext, MeetingSummarySnippet, Neo4jClient, UtteranceSnippet};
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
    pub client_id: String,
    pub client_name: Option<String>,
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
            m.client_id = $clientId,
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
    let mut final_summary = summary.filter(|s| !s.trim().is_empty());
    if final_summary.is_none() {
        final_summary = build_meeting_summary_from_utterances(&neo, &meeting_id).await?;
    }
    neo.run(
        r#"
        MATCH (m:Meeting {id: $meetingId})
        SET m.ended_at = datetime(),
            m.status = 'completed',
            m.summary = CASE
                WHEN $summary IS NOT NULL AND $summary <> '' THEN $summary
                ELSE m.summary
            END
        "#,
        json!({
            "meetingId": meeting_id,
            "summary": final_summary,
        }),
    )
    .await?;
    Ok(())
}

async fn build_meeting_summary_from_utterances(
    neo: &Neo4jClient,
    meeting_id: &str,
) -> Result<Option<String>, String> {
    let data = neo
        .run(
            r#"
            MATCH (m:Meeting {id: $meetingId})-[:HAS_UTTERANCE]->(u:Utterance)
            RETURN m.id AS meetingId,
                   u.speaker_label AS speaker,
                   u.text AS text,
                   u.sequence_num AS sequenceNum
            ORDER BY coalesce(u.sequence_num, 0) ASC,
                     coalesce(u.created_at, datetime({epochMillis:0})) ASC
            "#,
            json!({ "meetingId": meeting_id }),
        )
        .await?;

    let utterances = utterance_snippets_list(data);
    let transcript = utterances_to_transcript_refs(utterances.iter());
    if transcript.trim().is_empty() {
        return Ok(None);
    }
    let clipped = if transcript.len() > 6000 {
        transcript[transcript.len().saturating_sub(6000)..].to_string()
    } else {
        transcript
    };
    Ok(Some(clipped))
}

fn utterances_to_transcript_refs<'a>(
    utterances: impl IntoIterator<Item = &'a UtteranceSnippet>,
) -> String {
    utterances
        .into_iter()
        .filter(|u| !u.text.trim().is_empty())
        .map(|u| {
            let label = u.speaker.as_deref().unwrap_or("speaker").to_lowercase();
            let role = if label == "client" {
                "Client"
            } else if label == "user" {
                "User"
            } else {
                "Speaker"
            };
            format!("{}: {}", role, u.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn knowledge_append_utterance(input: AppendUtteranceInput) -> Result<(), String> {
    let neo = client()?;
    let client_name = input
        .client_name
        .unwrap_or_else(|| input.client_id.clone());
    neo.run(
        r#"
        MERGE (c:Client {id: $clientId})
        SET c.name = coalesce($clientName, c.name, $clientId),
            c.updated_at = datetime()
        MERGE (m:Meeting {id: $meetingId})
        SET m.client_id = coalesce(m.client_id, $clientId),
            m.started_at = coalesce(m.started_at, datetime()),
            m.status = coalesce(m.status, 'in_progress')
        MERGE (c)-[:HAS_MEETING]->(m)
        MERGE (u:Utterance {id: $utteranceId})
        SET u.text = $text,
            u.speaker_label = $speakerLabel,
            u.sequence_num = $sequenceNum,
            u.created_at = datetime()
        MERGE (m)-[:HAS_UTTERANCE]->(u)
        "#,
        json!({
            "clientId": input.client_id,
            "clientName": client_name,
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

async fn repair_client_meeting_links(neo: &Neo4jClient, client_id: &str) -> Result<(), String> {
    neo.run(
        r#"
        MATCH (c:Client {id: $clientId})
        MATCH (m:Meeting)
        WHERE m.client_id = $clientId
        MERGE (c)-[:HAS_MEETING]->(m)
        "#,
        json!({ "clientId": client_id }),
    )
    .await?;

    neo.run(
        r#"
        MATCH (c:Client)-[:HAS_MEETING]->(m:Meeting)
        WHERE m.client_id IS NULL OR m.client_id = ''
        SET m.client_id = c.id
        "#,
        json!({}),
    )
    .await?;

    neo.run(
        r#"
        MATCH (c:Client)
        WITH collect(c) AS clients
        WHERE size(clients) = 1
        WITH clients[0] AS c
        MATCH (m:Meeting)-[:HAS_UTTERANCE]->(:Utterance)
        WHERE NOT (()-[:HAS_MEETING]->(m))
        MERGE (c)-[:HAS_MEETING]->(m)
        SET m.client_id = coalesce(m.client_id, c.id)
        "#,
        json!({}),
    )
    .await?;

    Ok(())
}

async fn link_meetings_for_client(neo: &Neo4jClient, client_id: &str) -> Result<(), String> {
    neo.run(
        r#"
        MATCH (c:Client {id: $clientId})
        MATCH (m:Meeting)
        WHERE m.client_id = $clientId
        MERGE (c)-[:HAS_MEETING]->(m)
        "#,
        json!({ "clientId": client_id }),
    )
    .await?;

    neo.run(
        r#"
        MATCH (c:Client {id: $clientId})
        MATCH (m:Meeting)-[:HAS_UTTERANCE]->(:Utterance)
        WHERE coalesce(m.client_id, '') IN ['', $clientId]
        MERGE (c)-[:HAS_MEETING]->(m)
        SET m.client_id = $clientId
        "#,
        json!({ "clientId": client_id }),
    )
    .await?;

    Ok(())
}

async fn fetch_client_utterances(
    neo: &Neo4jClient,
    client_id: &str,
    client_name: Option<&str>,
) -> Result<Vec<UtteranceSnippet>, String> {
    let utterance_data = neo
        .run(
            r#"
            OPTIONAL MATCH (byId:Client {id: $clientId})
            OPTIONAL MATCH (byName:Client)
            WHERE $clientName IS NOT NULL AND $clientName <> '' AND (
                toLower(trim(byName.name)) = toLower(trim($clientName))
                OR toLower(byName.name) CONTAINS toLower(trim($clientName))
            )
            WITH coalesce(byId, head(collect(DISTINCT byName))) AS c
            MATCH (m:Meeting)-[:HAS_UTTERANCE]->(u:Utterance)
            WHERE m.client_id = $clientId
               OR (c IS NOT NULL AND (c)-[:HAS_MEETING]->(m))
               OR EXISTS { MATCH (:Client {id: $clientId})-[:HAS_MEETING]->(m) }
            RETURN DISTINCT m.id AS meetingId,
                   coalesce(u.speaker_label, 'client') AS speaker,
                   u.text AS text,
                   u.sequence_num AS sequenceNum,
                   toString(u.created_at) AS createdAt
            ORDER BY coalesce(u.sequence_num, 0) ASC, coalesce(u.created_at, datetime({epochMillis:0})) ASC
            LIMIT 200
            "#,
            json!({
                "clientId": client_id,
                "clientName": client_name.unwrap_or(""),
            }),
        )
        .await?;

    Ok(utterance_snippets_list(utterance_data))
}

async fn backfill_meeting_summaries_from_utterances(
    neo: &Neo4jClient,
    client_id: &str,
    utterances: &[UtteranceSnippet],
) -> Result<(), String> {
    let mut by_meeting: std::collections::HashMap<String, Vec<&UtteranceSnippet>> =
        std::collections::HashMap::new();
    for u in utterances {
        if let Some(mid) = &u.meeting_id {
            by_meeting.entry(mid.clone()).or_default().push(u);
        }
    }

    for (meeting_id, lines) in by_meeting {
        let mut sorted: Vec<&UtteranceSnippet> = lines;
        sorted.sort_by(|a, b| {
            a.sequence_num
                .unwrap_or(0)
                .cmp(&b.sequence_num.unwrap_or(0))
        });
        let transcript: String = utterances_to_transcript_refs(sorted.iter().map(|u| *u));
        if transcript.is_empty() {
            continue;
        }
        let clipped = if transcript.len() > 6000 {
            transcript[transcript.len().saturating_sub(6000)..].to_string()
        } else {
            transcript
        };
        neo.run(
            r#"
            MATCH (m:Meeting {id: $meetingId})
            WHERE coalesce(m.client_id, '') IN ['', $clientId]
              AND (m.summary IS NULL OR m.summary = '')
            SET m.summary = $summary,
                m.client_id = coalesce(m.client_id, $clientId)
            "#,
            json!({
                "meetingId": meeting_id,
                "clientId": client_id,
                "summary": clipped,
            }),
        )
        .await?;
    }

    Ok(())
}

fn json_to_i64(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

async fn count_linked_meetings(neo: &Neo4jClient, client_id: &str) -> Result<i64, String> {
    let data = neo
        .run(
            r#"
            MATCH (c:Client {id: $clientId})
            OPTIONAL MATCH (c)-[:HAS_MEETING]->(mRel:Meeting)
            WITH c, collect(DISTINCT mRel) AS relMeetings
            OPTIONAL MATCH (mProp:Meeting)
            WHERE mProp.client_id = c.id
            WITH c, relMeetings, collect(DISTINCT mProp) AS propMeetings
            WITH [m IN (relMeetings + propMeetings) WHERE m IS NOT NULL] AS rawMeetings
            UNWIND CASE WHEN size(rawMeetings) > 0 THEN rawMeetings ELSE [null] END AS m
            WITH [x IN collect(DISTINCT m) WHERE x IS NOT NULL] AS meetings
            RETURN size(meetings) AS meetingCount
            "#,
            json!({ "clientId": client_id }),
        )
        .await?;

    let count = data
        .get("values")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .and_then(|row| row.first());

    Ok(json_to_i64(count))
}

#[tauri::command]
pub async fn knowledge_get_client_context(
    client_id: String,
    client_name: Option<String>,
) -> Result<ClientContext, String> {
    let neo = client()?;
    repair_client_meeting_links(&neo, &client_id).await?;
    link_meetings_for_client(&neo, &client_id).await?;

    let resolved_id = client_id.clone();
    let utterances =
        fetch_client_utterances(&neo, &resolved_id, client_name.as_deref()).await?;
    if !utterances.is_empty() {
        let _ = backfill_meeting_summaries_from_utterances(&neo, &resolved_id, &utterances).await;
    }

    let data = neo
        .run(
            r#"
            OPTIONAL MATCH (byId:Client {id: $clientId})
            OPTIONAL MATCH (byName:Client)
            WHERE $clientName IS NOT NULL AND $clientName <> '' AND (
                toLower(trim(byName.name)) = toLower(trim($clientName))
                OR toLower(byName.name) CONTAINS toLower(trim($clientName))
                OR toLower(trim($clientName)) CONTAINS toLower(byName.name)
            )
            WITH coalesce(byId, head(collect(DISTINCT byName))) AS c
            OPTIONAL MATCH (c)-[:HAS_MEETING]->(mRel:Meeting)
            WITH c, collect(DISTINCT mRel) AS relMeetings
            OPTIONAL MATCH (mProp:Meeting)
            WHERE c IS NOT NULL AND mProp.client_id = c.id
            WITH c, relMeetings, collect(DISTINCT mProp) AS propMeetings
            WITH c,
                 [m IN (relMeetings + propMeetings) WHERE m IS NOT NULL] AS rawMeetings
            UNWIND CASE WHEN size(rawMeetings) > 0 THEN rawMeetings ELSE [null] END AS mx
            WITH c, [x IN collect(DISTINCT mx) WHERE x IS NOT NULL] AS meetings
            OPTIONAL MATCH (c)-[:HAS_FACT]->(f:Fact)
            WITH c, meetings, collect(DISTINCT f.text) AS facts
            UNWIND CASE WHEN size(meetings) > 0 THEN meetings ELSE [null] END AS m
            OPTIONAL MATCH (m)-[:RAISED]->(o:Objection {status: 'open'})
            OPTIONAL MATCH (m)-[:MENTIONED]->(q:Question {status: 'open'})
            OPTIONAL MATCH (m)-[:CREATED]->(a:ActionItem {status: 'open'})
            WITH c,
                 facts,
                 meetings,
                 collect(DISTINCT o.text) AS openObjections,
                 collect(DISTINCT q.text) AS openQuestions,
                 collect(DISTINCT a.text) AS openActions
            RETURN coalesce(c.id, $clientId) AS clientId,
                   coalesce(c.name, $clientName, $clientId) AS clientName,
                   size(meetings) AS meetingCount,
                   [x IN facts WHERE x IS NOT NULL AND x <> ''] AS facts,
                   [x IN openObjections WHERE x IS NOT NULL AND x <> ''] AS openObjections,
                   [x IN openQuestions WHERE x IS NOT NULL AND x <> ''] AS openQuestions,
                   [x IN openActions WHERE x IS NOT NULL AND x <> ''] AS openActions,
                   [m IN meetings | {
                       id: m.id,
                       number: m.number,
                       title: m.title,
                       date: coalesce(m.meeting_date, toString(m.started_at)),
                       summary: m.summary
                   }] AS meetingSummaries
            "#,
            json!({
                "clientId": client_id,
                "clientName": client_name.clone().unwrap_or_default(),
            }),
        )
        .await?;

    let mut ctx = parse_client_context(data)?;

    let resolved_id = if ctx.client_id.is_empty() {
        client_id.clone()
    } else {
        ctx.client_id.clone()
    };

    if ctx.meeting_count == 0 {
        ctx.meeting_count = count_linked_meetings(&neo, &resolved_id).await?;
    }

    ctx.recent_utterances = utterances;
    if ctx.meeting_count == 0 && !ctx.recent_utterances.is_empty() {
        ctx.meeting_count = count_linked_meetings(&neo, &resolved_id).await?;
    }

    Ok(ctx)
}

#[tauri::command]
pub async fn knowledge_fetch_client_utterances(
    client_id: String,
    client_name: Option<String>,
) -> Result<Vec<UtteranceSnippet>, String> {
    let neo = client()?;
    repair_client_meeting_links(&neo, &client_id).await?;
    link_meetings_for_client(&neo, &client_id).await?;
    fetch_client_utterances(&neo, &client_id, client_name.as_deref()).await
}

fn parse_client_context(data: Value) -> Result<ClientContext, String> {
    let values = data
        .get("values")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .ok_or_else(|| "No context returned from Neo4j".to_string())?;

    let client_id = values
        .first()
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let client_name = values
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("Client")
        .to_string();
    let meeting_count = json_to_i64(values.get(2));

    Ok(ClientContext {
        client_id,
        client_name,
        meeting_count,
        facts: string_list(values.get(3)),
        open_objections: string_list(values.get(4)),
        open_questions: string_list(values.get(5)),
        open_actions: string_list(values.get(6)),
        meeting_summaries: meeting_summaries_list(values.get(7)),
        recent_utterances: vec![],
    })
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn utterance_from_row(row: &Value) -> Option<UtteranceSnippet> {
    if let Some(obj) = row.as_object() {
        let text = obj
            .get("text")
            .map(json_value_to_string)
            .unwrap_or_default();
        if text.trim().is_empty() {
            return None;
        }
        return Some(UtteranceSnippet {
            meeting_id: obj
                .get("meetingId")
                .or_else(|| obj.get("meeting_id"))
                .map(json_value_to_string)
                .filter(|s| !s.is_empty()),
            speaker: obj
                .get("speaker")
                .or_else(|| obj.get("speaker_label"))
                .map(json_value_to_string)
                .filter(|s| !s.is_empty()),
            text,
            sequence_num: obj
                .get("sequenceNum")
                .or_else(|| obj.get("sequence_num"))
                .map(|v| json_to_i64(Some(v))),
            created_at: obj
                .get("createdAt")
                .or_else(|| obj.get("created_at"))
                .map(json_value_to_string)
                .filter(|s| !s.is_empty()),
        });
    }

    let row = row.as_array()?;
    let text = row.get(2).map(json_value_to_string).unwrap_or_default();
    if text.trim().is_empty() {
        return None;
    }
    Some(UtteranceSnippet {
        meeting_id: row
            .first()
            .map(json_value_to_string)
            .filter(|s| !s.is_empty()),
        speaker: row
            .get(1)
            .map(json_value_to_string)
            .filter(|s| !s.is_empty()),
        text,
        sequence_num: row.get(3).map(|v| json_to_i64(Some(v))),
        created_at: row
            .get(4)
            .map(json_value_to_string)
            .filter(|s| !s.is_empty()),
    })
}

fn utterance_snippets_list(data: Value) -> Vec<UtteranceSnippet> {
    data.get("values")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(utterance_from_row)
                .collect()
        })
        .unwrap_or_default()
}

fn meeting_summaries_list(value: Option<&Value>) -> Vec<MeetingSummarySnippet> {
    value
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    Some(MeetingSummarySnippet {
                        meeting_id: obj
                            .get("id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        number: obj.get("number").and_then(|v| v.as_i64()),
                        title: obj
                            .get("title")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        date: obj
                            .get("date")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        summary: obj
                            .get("summary")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSummary {
    pub client_id: String,
    pub client_name: String,
    pub meeting_count: i64,
}

#[tauri::command]
pub async fn knowledge_list_clients() -> Result<Vec<ClientSummary>, String> {
    let neo = client()?;
    let _ = repair_client_meeting_links(&neo, "").await;
    let data = neo
        .run(
            r#"
            MATCH (c:Client)
            OPTIONAL MATCH (c)-[:HAS_MEETING]->(mRel:Meeting)
            WITH c, collect(DISTINCT mRel) AS relMeetings
            OPTIONAL MATCH (mProp:Meeting)
            WHERE mProp.client_id = c.id
            WITH c, relMeetings, collect(DISTINCT mProp) AS propMeetings
            WITH c,
                 [m IN (relMeetings + propMeetings) WHERE m IS NOT NULL] AS rawMeetings
            UNWIND CASE WHEN size(rawMeetings) > 0 THEN rawMeetings ELSE [null] END AS m
            WITH c, [x IN collect(DISTINCT m) WHERE x IS NOT NULL] AS meetings
            RETURN c.id AS clientId,
                   coalesce(c.name, c.id) AS clientName,
                   size(meetings) AS meetingCount
            ORDER BY clientName
            "#,
            json!({}),
        )
        .await?;

    let rows = data
        .get("values")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(rows
        .iter()
        .filter_map(|row| row.as_array())
        .map(|row| ClientSummary {
            client_id: row.first().and_then(|v| v.as_str()).unwrap_or("").to_string(),
            client_name: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            meeting_count: json_to_i64(row.get(2)),
        })
        .filter(|c| !c.client_id.is_empty())
        .collect())
}

fn sybill_meeting_node_id(sybill_id: &str) -> String {
    format!("sybill_{sybill_id}")
}

#[tauri::command]
pub async fn knowledge_sybill_meeting_exists(sybill_id: String) -> Result<bool, String> {
    let neo = client()?;
    let meeting_id = sybill_meeting_node_id(&sybill_id);
    let data = neo
        .run(
            r#"
            MATCH (m:Meeting {id: $meetingId})
            RETURN count(m) AS total
            "#,
            json!({ "meetingId": meeting_id }),
        )
        .await?;

    let total = data
        .get("values")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .and_then(|row| row.first())
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Ok(total > 0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSybillMeetingInput {
    pub client_id: String,
    pub client_name: String,
    pub sybill_id: String,
    pub title: Option<String>,
    pub call_type: Option<String>,
    pub meeting_date: Option<String>,
    pub summary: Option<String>,
}

#[tauri::command]
pub async fn knowledge_import_sybill_meeting(
    input: ImportSybillMeetingInput,
) -> Result<String, String> {
    let neo = client()?;
    neo.ensure_constraints().await?;

    let meeting_id = sybill_meeting_node_id(&input.sybill_id);

    neo.run(
        r#"
        MERGE (c:Client {id: $clientId})
        SET c.name = $clientName, c.updated_at = datetime()
        MERGE (m:Meeting {id: $meetingId})
        SET m.source = 'sybill',
            m.sybill_id = $sybillId,
            m.client_id = $clientId,
            m.title = $title,
            m.call_type = $callType,
            m.meeting_date = $meetingDate,
            m.summary = coalesce($summary, m.summary),
            m.status = 'completed',
            m.started_at = coalesce(m.started_at, datetime())
        MERGE (c)-[:HAS_MEETING]->(m)
        "#,
        json!({
            "clientId": input.client_id,
            "clientName": input.client_name,
            "meetingId": meeting_id,
            "sybillId": input.sybill_id,
            "title": input.title,
            "callType": input.call_type,
            "meetingDate": input.meeting_date,
            "summary": input.summary,
        }),
    )
    .await?;

    Ok(meeting_id)
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
        input.min_score,
    )
    .await
}
