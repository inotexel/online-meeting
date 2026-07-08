use super::env::{
    load_dotenv, neo4j_database, neo4j_env_ready, neo4j_password, neo4j_uri, neo4j_user,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::error::Error;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Clone)]
pub struct Neo4jClient {
    http_base: String,
    auth_header: String,
    http: Client,
    database: String,
}

#[derive(Debug, Deserialize)]
struct QueryResponse {
    #[serde(default)]
    errors: Vec<QueryError>,
    data: Option<QueryData>,
}

#[derive(Debug, Deserialize)]
struct QueryError {
    message: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct QueryData {
    values: Option<Vec<Vec<Value>>>,
}

impl Neo4jClient {
    pub fn from_env() -> Result<Self, String> {
        load_dotenv();
        let uri = neo4j_uri()
            .ok_or_else(|| "Neo4j is not configured in this build.".to_string())?;
        let user = neo4j_user().unwrap_or_else(|| "neo4j".to_string());
        let password = neo4j_password()
            .ok_or_else(|| "Neo4j is not configured in this build.".to_string())?;
        let database = neo4j_database().unwrap_or_else(|| "neo4j".to_string());

        let http_base = bolt_uri_to_https(&uri);
        let token = B64.encode(format!("{user}:{password}"));
        let auth_header = format!("Basic {token}");

        Ok(Self {
            http_base,
            auth_header,
            http: Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .timeout(Duration::from_secs(90))
                .build()
                .map_err(|e| format!("Failed to create Neo4j HTTP client: {e}"))?,
            database,
        })
    }

    pub fn is_configured() -> bool {
        load_dotenv();
        neo4j_env_ready()
    }

    pub async fn run(&self, statement: &str, parameters: Value) -> Result<Value, String> {
        match self.run_once(statement, parameters.clone()).await {
            Ok(value) => Ok(value),
            Err(err) if is_retryable_transport_error(&err) => {
                sleep(Duration::from_secs(2)).await;
                self.run_once(statement, parameters).await
            }
            Err(err) => Err(err),
        }
    }

    async fn run_once(&self, statement: &str, parameters: Value) -> Result<Value, String> {
        let url = format!(
            "{}/db/{}/query/v2",
            self.http_base.trim_end_matches('/'),
            self.database
        );

        let response = self
            .http
            .post(&url)
            .header("Authorization", &self.auth_header)
            .header("Content-Type", "application/json")
            .json(&json!({
                "statement": statement,
                "parameters": parameters,
            }))
            .send()
            .await
            .map_err(format_neo4j_transport_error)?;

        let status = response.status();
        let body: QueryResponse = response
            .json()
            .await
            .map_err(|e| format!("Invalid Neo4j response JSON: {e}"))?;

        if !status.is_success() {
            let msg = body
                .errors
                .first()
                .and_then(|e| e.message.clone())
                .unwrap_or_else(|| format!("HTTP {status}"));
            return Err(msg);
        }

        if let Some(err) = body.errors.first() {
            if let Some(msg) = &err.message {
                return Err(msg.clone());
            }
        }

        Ok(serde_json::to_value(body.data).unwrap_or(Value::Null))
    }

    pub async fn deduplicate_nodes_by_id(&self, label: &str) -> Result<(), String> {
        let statement = format!(
            r#"
            MATCH (n:{label})
            WHERE n.id IS NOT NULL
            WITH n.id AS id, collect(n) AS nodes
            WHERE size(nodes) > 1
            WITH nodes[0] AS keeper, nodes[1..] AS dupes
            UNWIND dupes AS dup
            DETACH DELETE dup
            "#
        );
        self.run(statement.trim(), json!({})).await?;
        Ok(())
    }

    async fn deduplicate_graph_ids(&self) -> Result<(), String> {
        for label in [
            "Client",
            "Meeting",
            "Utterance",
            "Fact",
            "Objection",
            "Question",
            "ActionItem",
            "Document",
            "DocChunk",
        ] {
            self.deduplicate_nodes_by_id(label).await?;
        }
        Ok(())
    }

    pub async fn ensure_constraints(&self) -> Result<(), String> {
        self.deduplicate_graph_ids().await?;

        let statements = [
            "CREATE CONSTRAINT client_id IF NOT EXISTS FOR (c:Client) REQUIRE c.id IS UNIQUE",
            "CREATE CONSTRAINT meeting_id IF NOT EXISTS FOR (m:Meeting) REQUIRE m.id IS UNIQUE",
            "CREATE CONSTRAINT utterance_id IF NOT EXISTS FOR (u:Utterance) REQUIRE u.id IS UNIQUE",
            "CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE",
            "CREATE CONSTRAINT objection_id IF NOT EXISTS FOR (o:Objection) REQUIRE o.id IS UNIQUE",
            "CREATE CONSTRAINT question_id IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE",
            "CREATE CONSTRAINT action_item_id IF NOT EXISTS FOR (a:ActionItem) REQUIRE a.id IS UNIQUE",
        ];

        for statement in statements {
            match self.run(statement, json!({})).await {
                Ok(_) => {}
                Err(err) if constraint_error_is_benign(&err) => {}
                Err(err) if err.contains("have the label") => {
                    self.deduplicate_graph_ids().await?;
                    self.run(statement, json!({}))
                        .await
                        .map_err(|retry_err| {
                            format!(
                                "Neo4j still has duplicate nodes after cleanup. \
                                 In Aura Browser run: MATCH (m:Meeting) RETURN m.id, count(*) \
                                 then delete extras, or clear test data. Details: {retry_err}"
                            )
                        })?;
                }
                Err(err) => return Err(err),
            }
        }

        Ok(())
    }
}

fn constraint_error_is_benign(err: &str) -> bool {
    err.contains("already exists")
        || err.contains("Equivalent constraint")
        || err.contains("An equivalent constraint already exists")
}

fn is_retryable_transport_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("deadline has elapsed")
        || lower.contains("connection")
        || lower.contains("connect")
        || lower.contains("dns error")
}

fn format_neo4j_transport_error(err: reqwest::Error) -> String {
    let mut msg = format!("Neo4j HTTP request failed: {err}");
    let mut source = err.source();
    while let Some(cause) = source {
        msg.push_str(&format!(" ({cause})"));
        source = cause.source();
    }
    msg.push_str(
        ". Check that your Aura instance is running (not paused), NEO4J_URI uses neo4j+s://, \
         and outbound HTTPS is allowed.",
    );
    msg
}

fn bolt_uri_to_https(uri: &str) -> String {
    let trimmed = uri.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return trimmed.trim_end_matches('/').to_string();
    }

    trimmed
        .replace("neo4j+s://", "https://")
        .replace("neo4j://", "http://")
        .replace("bolt+s://", "https://")
        .replace("bolt://", "http://")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn neo4j_http_query_from_env_file() {
        load_dotenv();
        if !neo4j_env_ready() {
            eprintln!("Skipping Neo4j test: NEO4J_URI / NEO4J_PASSWORD not set");
            return;
        }

        let client = Neo4jClient::from_env().expect("Neo4jClient::from_env");
        let result = client.run("RETURN 1 AS n", json!({})).await;
        assert!(result.is_ok(), "Neo4j query failed: {:?}", result.err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UtteranceSnippet {
    pub meeting_id: Option<String>,
    pub speaker: Option<String>,
    pub text: String,
    pub sequence_num: Option<i64>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummarySnippet {
    pub meeting_id: Option<String>,
    pub number: Option<i64>,
    pub title: Option<String>,
    pub date: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientContext {
    pub client_id: String,
    pub client_name: String,
    pub facts: Vec<String>,
    pub open_objections: Vec<String>,
    pub open_questions: Vec<String>,
    pub open_actions: Vec<String>,
    pub meeting_count: i64,
    pub meeting_summaries: Vec<MeetingSummarySnippet>,
    #[serde(default)]
    pub recent_utterances: Vec<UtteranceSnippet>,
}
