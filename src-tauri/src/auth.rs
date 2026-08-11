// Account auth for the desktop app: browser + deep-link sign-in, session
// storage, and the /api/me entitlement check with an offline grace window.
//
// The app never sees a password. Sign-in opens the system browser; the web
// redirects to pluely://auth?code=<one-time>; we exchange code + our secret
// verifier (PKCE-style) for a Supabase session issued by our backend.

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_machine_uid::MachineUidExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

// In-memory verifier for the sign-in currently in flight. Never persisted:
// the whole point is that only this process can complete the exchange.
#[derive(Default)]
pub struct AuthFlowState {
    verifier: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Me {
    pub email: String,
    pub plan: String,
    pub entitled: bool,
    /// ISO timestamp until which `entitled` may be trusted without a server check.
    pub entitled_until: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredSession {
    access_token: String,
    refresh_token: String,
    me: Me,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub me: Option<Me>,
    /// True when we're honoring a cached verdict because the server was unreachable.
    pub offline: bool,
}

fn api_base() -> Result<String, String> {
    if let Ok(endpoint) = std::env::var("PAYMENT_ENDPOINT") {
        return Ok(endpoint.trim_end_matches('/').to_string());
    }
    match option_env!("PAYMENT_ENDPOINT") {
        Some(endpoint) => Ok(endpoint.trim_end_matches('/').to_string()),
        None => Err("PAYMENT_ENDPOINT is not configured".to_string()),
    }
}

/// The website root, derived from the API base (…/api → …).
fn site_base() -> Result<String, String> {
    Ok(api_base()?.trim_end_matches("/api").to_string())
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("auth_session.json"))
}

fn load_session(app: &AppHandle) -> Option<StoredSession> {
    let content = fs::read_to_string(session_path(app).ok()?).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_session(app: &AppHandle, session: &StoredSession) -> Result<(), String> {
    let content =
        serde_json::to_string(session).map_err(|e| format!("Failed to serialize session: {}", e))?;
    fs::write(session_path(app)?, content).map_err(|e| format!("Failed to write session: {}", e))
}

fn machine_id(app: &AppHandle) -> String {
    app.machine_uid()
        .get_machine_uid()
        .ok()
        .and_then(|uid| uid.id)
        .unwrap_or_default()
}

fn grace_still_valid(me: &Me) -> bool {
    // entitled_until is RFC3339 from the server. Unparseable/absent → not valid.
    me.entitled_until
        .as_deref()
        .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
        .map(|until| until > chrono::Utc::now())
        .unwrap_or(false)
}

/// Step 1: generate verifier, open the browser at the sign-in page.
#[tauri::command]
pub async fn auth_start_sign_in(
    app: AppHandle,
    state: tauri::State<'_, AuthFlowState>,
) -> Result<(), String> {
    // Two UUIDs = 256 bits of verifier entropy.
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge = hex::encode(Sha256::digest(verifier.as_bytes()));
    *state.verifier.lock().map_err(|_| "auth state poisoned")? = Some(verifier);

    let next = format!("/device-success?challenge={}", challenge);
    let url = format!(
        "{}/login?next={}",
        site_base()?,
        urlencoding::encode(&next)
    );
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open browser: {}", e))
}

/// Step 2: called with the code from the pluely://auth deep link.
pub async fn complete_sign_in(app: &AppHandle, code: &str) -> Result<Me, String> {
    let verifier = {
        let state = app.state::<AuthFlowState>();
        let mut guard = state.verifier.lock().map_err(|_| "auth state poisoned")?;
        guard.take() // single-use, matching the server's single-use code
    }
    .ok_or("No sign-in in progress — press Sign in and try again")?;

    #[derive(Deserialize)]
    struct ExchangeResponse {
        access_token: String,
        refresh_token: String,
        me: Me,
    }

    let response = reqwest::Client::new()
        .post(format!("{}/auth/exchange", api_base()?))
        .json(&json!({
            "code": code,
            "verifier": verifier,
            "machine_id": machine_id(app),
            "app_version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
        }))
        .send()
        .await
        .map_err(|e| format!("Sign-in request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Sign-in was rejected ({})", response.status()));
    }
    let exchange: ExchangeResponse = response
        .json()
        .await
        .map_err(|e| format!("Unexpected sign-in response: {}", e))?;

    save_session(
        app,
        &StoredSession {
            access_token: exchange.access_token,
            refresh_token: exchange.refresh_token,
            me: exchange.me.clone(),
        },
    )?;

    let _ = app.emit("auth-changed", ());
    Ok(exchange.me)
}

/// Deep-link entry point, wired in lib.rs. Accepts pluely://auth?code=…
pub fn handle_deep_link(app: &AppHandle, urls: Vec<url::Url>) {
    for link in urls {
        if link.scheme() != "pluely" || link.host_str() != Some("auth") {
            continue;
        }
        let Some(code) = link
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string())
        else {
            continue;
        };

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match complete_sign_in(&app, &code).await {
                Ok(me) => println!("Signed in as {}", me.email),
                Err(e) => {
                    eprintln!("Sign-in failed: {}", e);
                    let _ = app.emit("auth-error", e);
                }
            }
        });
    }
}

/// Session + entitlement, refreshing against the server when reachable and
/// honoring the cached grace window when not.
#[tauri::command]
pub async fn auth_get_status(app: AppHandle) -> Result<AuthStatus, String> {
    let Some(mut session) = load_session(&app) else {
        return Ok(AuthStatus { signed_in: false, me: None, offline: false });
    };
    let base = api_base()?;
    let client = reqwest::Client::new();

    // Try /me with the current access token; on 401, refresh once and retry.
    for attempt in 0..2 {
        let response = client
            .get(format!("{}/me", base))
            .bearer_auth(&session.access_token)
            .header("x-machine-id", machine_id(&app))
            .send()
            .await;

        match response {
            Ok(res) if res.status().is_success() => {
                let me: Me = res
                    .json()
                    .await
                    .map_err(|e| format!("Unexpected /me response: {}", e))?;
                session.me = me.clone();
                save_session(&app, &session)?;
                return Ok(AuthStatus { signed_in: true, me: Some(me), offline: false });
            }
            Ok(res) if res.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 => {
                // Access token expired — refresh and loop.
                #[derive(Deserialize)]
                struct Refreshed {
                    access_token: String,
                    refresh_token: String,
                }
                let refreshed = client
                    .post(format!("{}/auth/refresh", base))
                    .json(&json!({ "refresh_token": session.refresh_token }))
                    .send()
                    .await;
                match refreshed {
                    Ok(res) if res.status().is_success() => {
                        let tokens: Refreshed = res
                            .json()
                            .await
                            .map_err(|e| format!("Unexpected refresh response: {}", e))?;
                        session.access_token = tokens.access_token;
                        session.refresh_token = tokens.refresh_token;
                        save_session(&app, &session)?;
                        continue;
                    }
                    Ok(_) => {
                        // Refresh definitively rejected: session is dead.
                        let _ = fs::remove_file(session_path(&app)?);
                        let _ = app.emit("auth-changed", ());
                        return Ok(AuthStatus { signed_in: false, me: None, offline: false });
                    }
                    Err(_) => break, // network trouble → grace path below
                }
            }
            Ok(_) => {
                // Server reachable but unhappy (5xx, our bug) → grace path.
                break;
            }
            Err(_) => break, // offline → grace path
        }
    }

    // Server unreachable or erroring: honor the cached verdict inside its window.
    let entitled_now = grace_still_valid(&session.me);
    let mut me = session.me.clone();
    if !entitled_now {
        me.entitled = false;
        me.plan = "free".to_string();
    }
    Ok(AuthStatus { signed_in: true, me: Some(me), offline: true })
}

/// Bearer token for hosted-model API calls. Errors if signed out.
pub fn current_access_token(app: &AppHandle) -> Result<String, String> {
    load_session(app)
        .map(|session| session.access_token)
        .ok_or_else(|| "Not signed in. Please sign in to use Pluely models.".to_string())
}

/// Cheap, offline-safe entitlement check from the cached session (no network).
/// The grace window bounds how stale this may be; auth_get_status refreshes it.
pub fn is_entitled_cached(app: &AppHandle) -> bool {
    load_session(app)
        .map(|session| session.me.entitled && grace_still_valid(&session.me))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn auth_sign_out(app: AppHandle) -> Result<(), String> {
    // Best-effort server-side device removal; local sign-out must not depend on it.
    if let (Some(session), Ok(base)) = (load_session(&app), api_base()) {
        let _ = reqwest::Client::new()
            .delete(format!("{}/devices/current", base))
            .bearer_auth(&session.access_token)
            .header("x-machine-id", machine_id(&app))
            .send()
            .await;
    }
    let _ = fs::remove_file(session_path(&app)?);
    let _ = app.emit("auth-changed", ());
    Ok(())
}
