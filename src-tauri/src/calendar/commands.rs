use super::google::{self, UpcomingMeeting};
use super::oauth;
use super::storage::clear_tokens;
use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarStatus {
    pub configured: bool,
    pub connected: bool,
}

#[tauri::command]
pub fn calendar_is_configured() -> bool {
    google::is_configured()
}

#[tauri::command]
pub fn calendar_get_status(app: AppHandle) -> Result<CalendarStatus, String> {
    Ok(CalendarStatus {
        configured: google::is_configured(),
        connected: google::connection_status(&app)?,
    })
}

#[tauri::command]
pub async fn calendar_connect(app: AppHandle) -> Result<(), String> {
    oauth::run_connect_flow(app).await
}

#[tauri::command]
pub fn calendar_disconnect(app: AppHandle) -> Result<(), String> {
    clear_tokens(&app)
}

#[tauri::command]
pub async fn calendar_fetch_upcoming(app: AppHandle) -> Result<Vec<UpcomingMeeting>, String> {
    google::fetch_upcoming_meetings(&app, 3).await
}

#[tauri::command]
pub fn calendar_redirect_uri() -> String {
    oauth::redirect_uri()
}
