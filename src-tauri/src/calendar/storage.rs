use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const TOKEN_FILE: &str = "google_calendar_tokens.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_email: String,
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data directory: {}", e))?;
    Ok(dir.join(TOKEN_FILE))
}

pub fn load_tokens(app: &AppHandle) -> Result<Option<GoogleTokens>, String> {
    let path = token_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read calendar tokens: {}", e))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let tokens: GoogleTokens =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid calendar token file: {}", e))?;
    if tokens.refresh_token.is_empty() {
        return Ok(None);
    }
    Ok(Some(tokens))
}

pub fn save_tokens(app: &AppHandle, tokens: &GoogleTokens) -> Result<(), String> {
    let path = token_path(app)?;
    let raw = serde_json::to_string_pretty(tokens)
        .map_err(|e| format!("Failed to serialize calendar tokens: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to save calendar tokens: {}", e))
}

pub fn clear_tokens(app: &AppHandle) -> Result<(), String> {
    let path = token_path(app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove calendar tokens: {}", e))?;
    }
    Ok(())
}
