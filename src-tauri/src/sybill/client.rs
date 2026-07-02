use reqwest::Client;
use serde_json::Value;

const SYBILL_BASE: &str = "https://api.sybill.ai";

/// Thin authenticated proxy around the Sybill REST API.
/// Keeping it in Rust avoids exposing the `sk_live_` key to the webview
/// and sidesteps browser CORS restrictions.
pub struct SybillClient {
    http: Client,
    api_key: String,
}

impl SybillClient {
    pub fn new(api_key: String) -> Self {
        // A User-Agent is required: Sybill sits behind an edge/CDN that returns
        // an HTML "403 Forbidden" for requests without one (default reqwest
        // sends no User-Agent header).
        let http = Client::builder()
            .user_agent(concat!("Pluely/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { http, api_key }
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
        let url = format!("{}{}", SYBILL_BASE, path);

        let mut request = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Accept", "application/json");

        let filtered: Vec<(&str, String)> = query
            .iter()
            .filter(|(_, value)| !value.trim().is_empty())
            .cloned()
            .collect();
        if !filtered.is_empty() {
            request = request.query(&filtered);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Sybill request failed: {e}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read Sybill response: {e}"))?;

        if !status.is_success() {
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("detail").cloned())
                .map(|d| d.to_string())
                .unwrap_or_else(|| body.clone());
            return Err(format!("Sybill API error ({status}): {detail}"));
        }

        serde_json::from_str::<Value>(&body)
            .map_err(|e| format!("Invalid Sybill JSON: {e}"))
    }

    pub async fn health(&self) -> Result<Value, String> {
        self.get("/v1/health", &[]).await
    }

    pub async fn list_conversations(
        &self,
        started_after: Option<String>,
        meeting_type: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> Result<Value, String> {
        let query = vec![
            ("limit", limit.clamp(1, 50).to_string()),
            ("startedAfter", started_after.unwrap_or_default()),
            ("type", meeting_type.unwrap_or_default()),
            ("cursor", cursor.unwrap_or_default()),
        ];
        self.get("/v1/conversations", &query).await
    }

    pub async fn get_conversation(&self, conversation_id: &str) -> Result<Value, String> {
        self.get(&format!("/v1/conversations/{conversation_id}"), &[])
            .await
    }
}
