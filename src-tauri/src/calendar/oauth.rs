use super::storage::{save_tokens, GoogleTokens};
use serde::Deserialize;
use crate::knowledge::env::{google_client_id, google_client_secret, load_dotenv};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::warn;

pub const REDIRECT_PORT: u16 = 14528;
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPES: &str = "https://www.googleapis.com/auth/calendar.readonly";

pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{}/callback", REDIRECT_PORT)
}

pub fn client_id() -> Result<String, String> {
    load_dotenv();
    google_client_id().ok_or_else(|| {
        "Google Calendar is not configured in this build.".to_string()
    })
}

fn client_secret() -> Option<String> {
    load_dotenv();
    google_client_secret()
}

fn build_auth_url(state: &str) -> Result<String, String> {
    let client_id = client_id()?;
    let redirect = redirect_uri();
    let query = [
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("state", state),
    ];
    let qs: Vec<String> = query
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect();
    Ok(format!("{}?{}", AUTH_URL, qs.join("&")))
}

async fn wait_for_callback(port: u16, expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .map_err(|e| format!("Failed to start OAuth callback server on port {}: {}", port, e))?;

    let (mut stream, _) = tokio::time::timeout(
        std::time::Duration::from_secs(180),
        listener.accept(),
    )
    .await
    .map_err(|_| "Google sign-in timed out. Try Connect again.".to_string())?
    .map_err(|e| format!("OAuth callback failed: {}", e))?;

    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read OAuth callback: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let request_line = request.lines().next().unwrap_or("");
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("");
    let query = path
        .strip_prefix("/callback")
        .unwrap_or(path)
        .trim_start_matches('?');
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut error: Option<String> = None;

    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts
            .next()
            .map(|v| urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_default())
            .unwrap_or_default();
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }

    let body = if let Some(err) = error {
        format!(
            "OAuth error: {}. You can close this tab and return to Pluely.",
            err
        )
    } else if state.as_deref() != Some(expected_state) {
        "Invalid OAuth state. You can close this tab and try again in Pluely.".to_string()
    } else if let Some(ref auth_code) = code {
        let _ = stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
                  <html><body><h2>Google Calendar connected</h2><p>You can close this tab and return to Pluely.</p></body></html>",
            )
            .await;
        return Ok(auth_code.clone());
    } else {
        "Missing authorization code.".to_string()
    };

    let response = format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
         <html><body><p>{}</p></body></html>",
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    Err(body)
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    email: Option<String>,
}

async fn exchange_code(code: &str) -> Result<TokenResponse, String> {
    let client_id = client_id()?;
    let redirect = redirect_uri();
    let mut params = vec![
        ("code", code.to_string()),
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("grant_type", "authorization_code".to_string()),
    ];
    if let Some(secret) = client_secret() {
        params.push(("client_secret", secret));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    if !status.is_success() {
        return Err(format!("Google token error ({}): {}", status, text));
    }

    serde_json::from_str(&text).map_err(|e| format!("Invalid token response: {} — {}", e, text))
}

pub async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client_id = client_id()?;
    let mut params = vec![
        ("refresh_token", refresh_token.to_string()),
        ("client_id", client_id),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(secret) = client_secret() {
        params.push(("client_secret", secret));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    if !status.is_success() {
        return Err(format!("Google refresh error ({}): {}", status, text));
    }

    serde_json::from_str(&text).map_err(|e| format!("Invalid refresh response: {} — {}", e, text))
}

async fn fetch_user_email(access_token: &str) -> String {
    let client = reqwest::Client::new();
    match client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(info) = resp.json::<UserInfo>().await {
                return info.email.unwrap_or_default();
            }
        }
        Ok(resp) => {
            warn!("Userinfo request failed: {}", resp.status());
        }
        Err(e) => {
            warn!("Userinfo request error: {}", e);
        }
    }
    String::new()
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub async fn run_connect_flow(app: AppHandle) -> Result<(), String> {
    let state = uuid::Uuid::new_v4().to_string();
    let auth_url = build_auth_url(&state)?;

    let wait_state = state.clone();
    let wait_handle = tokio::spawn(async move { wait_for_callback(REDIRECT_PORT, &wait_state).await });

    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser for Google sign-in: {}", e))?;

    let code = wait_handle
        .await
        .map_err(|e| format!("OAuth task failed: {}", e))??;

    let token_resp = exchange_code(&code).await?;
    let refresh_token = token_resp
        .refresh_token
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            "Google did not return a refresh token. Disconnect in Google Account settings and try again.".to_string()
        })?;

    let expires_in = token_resp.expires_in.unwrap_or(3600);
    let user_email = fetch_user_email(&token_resp.access_token).await;

    let tokens = GoogleTokens {
        access_token: token_resp.access_token,
        refresh_token,
        expires_at: now_secs() + expires_in - 60,
        user_email,
    };

    save_tokens(&app, &tokens)?;
    let _ = app.emit("google-calendar-connected", ());
    Ok(())
}
