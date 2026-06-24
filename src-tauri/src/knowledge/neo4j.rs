use super::env::{load_dotenv, neo4j_env_ready};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
        let uri = std::env::var("NEO4J_URI")
            .map_err(|_| "NEO4J_URI is not set in src-tauri/.env".to_string())?;
        let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".to_string());
        let password = std::env::var("NEO4J_PASSWORD")
            .map_err(|_| "NEO4J_PASSWORD is not set in src-tauri/.env".to_string())?;
        let database = std::env::var("NEO4J_DATABASE").unwrap_or_else(|_| "neo4j".to_string());

        let http_base = bolt_uri_to_https(&uri);
        let token = B64.encode(format!("{user}:{password}"));
        let auth_header = format!("Basic {token}");

        Ok(Self {
            http_base,
            auth_header,
            http: Client::new(),
            database,
        })
    }

    pub fn is_configured() -> bool {
        load_dotenv();
        neo4j_env_ready()
    }

    pub async fn run(&self, statement: &str, parameters: Value) -> Result<Value, String> {
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
            .map_err(|e| format!("Neo4j HTTP request failed: {e}"))?;

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
}
