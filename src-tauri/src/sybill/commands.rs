use super::client::SybillClient;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SybillHealth {
    pub ok: bool,
    pub org_id: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SybillParticipant {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SybillConversationSummary {
    pub conversation_id: String,
    pub title: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub meeting_type: Option<String>,
    pub participants: Vec<SybillParticipant>,
    pub crm_id: Option<String>,
    pub crm_type: Option<String>,
    pub crm_name: Option<String>,
    pub suggested_client_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SybillListResult {
    pub conversations: Vec<SybillConversationSummary>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SybillConversationDetail {
    pub conversation_id: String,
    pub title: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub meeting_type: Option<String>,
    pub category: Option<String>,
    pub participants: Vec<SybillParticipant>,
    pub crm_id: Option<String>,
    pub crm_type: Option<String>,
    pub crm_name: Option<String>,
    pub suggested_client_name: Option<String>,
    pub transcript_text: String,
    pub summary_text: String,
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_participants(value: &Value) -> Vec<SybillParticipant> {
    value
        .get("participants")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| SybillParticipant {
                    name: str_field(item, "name"),
                    email: str_field(item, "email"),
                })
                .collect()
        })
        .unwrap_or_default()
}

struct CrmFields {
    id: Option<String>,
    crm_type: Option<String>,
    name: Option<String>,
}

fn parse_crm(value: &Value) -> CrmFields {
    let Some(crm) = value.get("crm") else {
        return CrmFields {
            id: None,
            crm_type: None,
            name: None,
        };
    };
    CrmFields {
        id: str_field(crm, "id"),
        crm_type: str_field(crm, "type"),
        name: str_field(crm, "name"),
    }
}

fn crm_name(value: &Value) -> Option<String> {
    parse_crm(value).name
}

/// Pick the best human-readable client/company name for the graph.
/// Order: CRM deal/account name → external participant email domain.
fn suggested_client_name(value: &Value, participants: &[SybillParticipant]) -> Option<String> {
    if let Some(name) = crm_name(value) {
        return Some(name);
    }

    for participant in participants {
        if let Some(email) = &participant.email {
            if let Some(domain) = email.split('@').nth(1) {
                let root = domain.split('.').next().unwrap_or(domain).trim();
                if !root.is_empty() && !is_generic_domain(root) {
                    let mut chars = root.chars();
                    if let Some(first) = chars.next() {
                        return Some(format!(
                            "{}{}",
                            first.to_uppercase(),
                            chars.as_str()
                        ));
                    }
                }
            }
        }
    }

    None
}

fn is_generic_domain(root: &str) -> bool {
    matches!(
        root.to_lowercase().as_str(),
        "gmail" | "yahoo" | "outlook" | "hotmail" | "icloud" | "proton" | "aol"
    )
}

fn summary_to_text(value: &Value) -> String {
    let Some(summary) = value.get("summary") else {
        return String::new();
    };

    match summary {
        Value::Object(map) => {
            let mut lines = Vec::new();
            for (key, val) in map {
                let rendered = match val {
                    Value::String(s) => s.trim().to_string(),
                    Value::Array(items) => items
                        .iter()
                        .filter_map(|i| i.as_str())
                        .collect::<Vec<_>>()
                        .join("; "),
                    other => other.to_string(),
                };
                if !rendered.is_empty() {
                    lines.push(format!("{key}: {rendered}"));
                }
            }
            lines.join("\n")
        }
        Value::String(s) => s.trim().to_string(),
        _ => String::new(),
    }
}

fn transcript_to_text(value: &Value) -> String {
    value
        .get("transcript")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let text = item.get("text").and_then(|t| t.as_str())?.trim();
                    if text.is_empty() {
                        return None;
                    }
                    let speaker = item
                        .get("speaker")
                        .and_then(|s| s.as_str())
                        .unwrap_or("Speaker")
                        .trim();
                    Some(format!("{speaker}: {text}"))
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn parse_summary(item: &Value) -> SybillConversationSummary {
    let participants = parse_participants(item);
    let crm = parse_crm(item);
    let suggested = suggested_client_name(item, &participants);
    SybillConversationSummary {
        conversation_id: str_field(item, "conversationId").unwrap_or_default(),
        title: str_field(item, "title"),
        start_time: str_field(item, "startTime"),
        end_time: str_field(item, "endTime"),
        meeting_type: str_field(item, "type"),
        participants,
        crm_id: crm.id,
        crm_type: crm.crm_type,
        crm_name: crm.name,
        suggested_client_name: suggested,
    }
}

#[tauri::command]
pub async fn sybill_health_check(api_key: String) -> Result<SybillHealth, String> {
    if api_key.trim().is_empty() {
        return Err("Sybill API key is required".to_string());
    }

    let client = SybillClient::new(api_key);
    let data = client.health().await?;

    let scopes = data
        .get("scopes")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(SybillHealth {
        ok: str_field(&data, "status").as_deref() == Some("ok"),
        org_id: str_field(&data, "org_id"),
        scopes,
    })
}

#[tauri::command]
pub async fn sybill_list_conversations(
    api_key: String,
    started_after: Option<String>,
    meeting_type: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<SybillListResult, String> {
    if api_key.trim().is_empty() {
        return Err("Sybill API key is required".to_string());
    }

    let client = SybillClient::new(api_key);
    let data = client
        .list_conversations(started_after, meeting_type, cursor, limit.unwrap_or(50))
        .await?;

    let conversations = data
        .get("conversations")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().map(parse_summary).collect())
        .unwrap_or_default();

    let next_cursor = data
        .get("pagination")
        .and_then(|p| p.get("nextCursor"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    let has_more = data
        .get("pagination")
        .and_then(|p| p.get("hasMore"))
        .and_then(|h| h.as_bool())
        .unwrap_or(false);

    Ok(SybillListResult {
        conversations,
        next_cursor,
        has_more,
    })
}

#[tauri::command]
pub async fn sybill_get_conversation(
    api_key: String,
    conversation_id: String,
) -> Result<SybillConversationDetail, String> {
    if api_key.trim().is_empty() {
        return Err("Sybill API key is required".to_string());
    }
    if conversation_id.trim().is_empty() {
        return Err("conversationId is required".to_string());
    }

    let client = SybillClient::new(api_key);
    let data = client.get_conversation(&conversation_id).await?;

    let participants = parse_participants(&data);
    let crm = parse_crm(&data);
    let suggested = suggested_client_name(&data, &participants);

    Ok(SybillConversationDetail {
        conversation_id: str_field(&data, "conversationId").unwrap_or(conversation_id),
        title: str_field(&data, "title"),
        start_time: str_field(&data, "startTime"),
        end_time: str_field(&data, "endTime"),
        meeting_type: str_field(&data, "type"),
        category: str_field(&data, "category"),
        participants,
        crm_id: crm.id,
        crm_type: crm.crm_type,
        crm_name: crm.name,
        suggested_client_name: suggested,
        transcript_text: transcript_to_text(&data),
        summary_text: summary_to_text(&data),
    })
}
