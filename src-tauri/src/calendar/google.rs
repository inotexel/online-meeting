use std::collections::HashSet;

use super::oauth::{self, refresh_access_token};
use super::storage::{load_tokens, save_tokens, GoogleTokens};
use chrono::{DateTime, Local, NaiveDate, Utc};
use serde::Deserialize;
use tauri::AppHandle;

const CALENDAR_EVENTS_URL: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingMeeting {
    pub id: String,
    pub title: String,
    pub with_whom: String,
    pub suggested_client_name: String,
    pub start_label: String,
}

#[derive(Debug, Deserialize)]
struct EventsResponse {
    items: Option<Vec<CalendarEvent>>,
}

#[derive(Debug, Deserialize)]
struct CalendarEvent {
    id: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    start: Option<EventTime>,
    end: Option<EventTime>,
    attendees: Option<Vec<Attendee>>,
    organizer: Option<Attendee>,
    #[serde(rename = "recurringEventId")]
    recurring_event_id: Option<String>,
    #[serde(rename = "iCalUID")]
    ical_uid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventTime {
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Attendee {
    email: Option<String>,
    display_name: Option<String>,
    #[serde(rename = "self")]
    is_self: Option<bool>,
    resource: Option<bool>,
}

async fn ensure_access_token(app: &AppHandle) -> Result<GoogleTokens, String> {
    let mut tokens = load_tokens(app)?
        .ok_or_else(|| "Google Calendar is not connected.".to_string())?;

    if tokens.expires_at <= oauth::now_secs() {
        let refreshed = refresh_access_token(&tokens.refresh_token).await?;
        tokens.access_token = refreshed.access_token;
        tokens.expires_at = oauth::now_secs() + refreshed.expires_in.unwrap_or(3600) - 60;
        save_tokens(app, &tokens)?;
    }

    Ok(tokens)
}

fn user_domain(email: &str) -> Option<String> {
    let domain = email.split('@').nth(1)?.to_lowercase();
    if domain.is_empty() {
        return None;
    }
    Some(domain)
}

fn is_generic_email_domain(domain: &str) -> bool {
    matches!(
        domain,
        "gmail.com"
            | "googlemail.com"
            | "outlook.com"
            | "hotmail.com"
            | "live.com"
            | "yahoo.com"
            | "icloud.com"
            | "me.com"
            | "proton.me"
            | "protonmail.com"
    )
}

fn capitalize_word(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn domain_to_company(domain: &str) -> String {
    let stem = domain
        .split('.')
        .next()
        .unwrap_or(domain)
        .replace('-', " ");
    capitalize_word(&stem)
}

fn title_client_hint(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return None;
    }
    for sep in [" – ", " - ", " | ", ": "] {
        if let Some((left, right)) = trimmed.split_once(sep) {
            let left = left.trim();
            let right = right.trim();
            if right.len() >= 2 {
                return Some(right.to_string());
            }
            if left.len() >= 2 {
                return Some(left.to_string());
            }
        }
    }
    Some(trimmed.to_string())
}

struct ExternalAttendee {
    name: String,
    domain: String,
}

fn external_attendees(event: &CalendarEvent, user_email: &str) -> Vec<ExternalAttendee> {
    let own_domain = user_domain(user_email);
    let mut out = Vec::new();

    let mut people: Vec<&Attendee> = event.attendees.as_deref().unwrap_or(&[]).iter().collect();
    if people.is_empty() {
        if let Some(ref org) = event.organizer {
            people.push(org);
        }
    }

    for person in people {
        if person.resource.unwrap_or(false) || person.is_self.unwrap_or(false) {
            continue;
        }
        let email = person.email.as_deref().unwrap_or("").to_lowercase();
        if email.is_empty() {
            continue;
        }
        let domain = match user_domain(&email) {
            Some(d) => d,
            None => continue,
        };
        if own_domain.as_ref() == Some(&domain) {
            continue;
        }
        let name = person
            .display_name
            .as_deref()
            .filter(|n| !n.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| email.clone());
        out.push(ExternalAttendee { name, domain });
    }

    out
}

fn resolve_client_name(event: &CalendarEvent, user_email: &str) -> (String, String) {
    let title = event.summary.as_deref().unwrap_or("Untitled meeting").trim();
    let externals = external_attendees(event, user_email);

    let with_whom = if externals.is_empty() {
        title_client_hint(title).unwrap_or_else(|| "External meeting".to_string())
    } else {
        externals
            .iter()
            .map(|p| p.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    };

    let suggested = if !externals.is_empty() {
        let domain_counts = externals.iter().fold(std::collections::HashMap::new(), |mut acc, p| {
            *acc.entry(p.domain.clone()).or_insert(0) += 1;
            acc
        });
        let primary_domain = domain_counts
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(domain, _)| domain);

        if let Some(domain) = primary_domain {
            if is_generic_email_domain(&domain) {
                externals
                    .first()
                    .map(|p| p.name.clone())
                    .or_else(|| title_client_hint(title))
                    .unwrap_or_else(|| title.to_string())
            } else {
                domain_to_company(&domain)
            }
        } else {
            title_client_hint(title).unwrap_or_else(|| title.to_string())
        }
    } else {
        title_client_hint(title).unwrap_or_else(|| title.to_string())
    };

    (with_whom, suggested)
}

fn event_start_key(start: &EventTime) -> String {
    start
        .date_time
        .clone()
        .or_else(|| start.date.clone())
        .unwrap_or_default()
}

fn parse_event_time_utc(time: &EventTime) -> Option<DateTime<Utc>> {
    if let Some(ref dt) = time.date_time {
        return DateTime::parse_from_rfc3339(dt)
            .ok()
            .map(|parsed| parsed.with_timezone(&Utc));
    }
    if let Some(ref d) = time.date {
        let date = NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()?;
        return Some(date.and_hms_opt(0, 0, 0)?.and_utc());
    }
    None
}

fn event_start_utc(event: &CalendarEvent) -> Option<DateTime<Utc>> {
    event.start.as_ref().and_then(parse_event_time_utc)
}

fn event_end_utc(event: &CalendarEvent) -> Option<DateTime<Utc>> {
    event
        .end
        .as_ref()
        .and_then(parse_event_time_utc)
        .or_else(|| event.start.as_ref().and_then(parse_event_time_utc))
}

/// True when the event has not ended yet (still in progress or in the future).
fn is_event_upcoming(event: &CalendarEvent, now: DateTime<Utc>) -> bool {
    match event_end_utc(event) {
        Some(end) => end > now,
        None => event_start_utc(event).is_none_or(|start| start > now),
    }
}

fn format_start_label(start: &EventTime) -> String {
    if let Some(ref dt) = start.date_time {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(dt) {
            return parsed
                .with_timezone(&Local)
                .format("%a %b %d, %I:%M %p")
                .to_string();
        }
    }
    if let Some(ref d) = start.date {
        if let Ok(date) = NaiveDate::parse_from_str(d, "%Y-%m-%d") {
            return date.format("%a %b %d").to_string();
        }
        return d.clone();
    }
    String::new()
}

fn event_series_key(event: &CalendarEvent) -> Option<String> {
    if let Some(ref recurring_id) = event.recurring_event_id {
        if !recurring_id.is_empty() {
            return Some(format!("recurring:{}", recurring_id));
        }
    }
    if let Some(ref uid) = event.ical_uid {
        if !uid.is_empty() {
            return Some(format!("ical:{}", uid));
        }
    }
    None
}

pub async fn fetch_upcoming_meetings(app: &AppHandle, limit: usize) -> Result<Vec<UpcomingMeeting>, String> {
    let tokens = ensure_access_token(app).await?;
    let time_min = Utc::now().to_rfc3339();
    let now = Utc::now();

    let client = reqwest::Client::new();
    let response = client
        .get(CALENDAR_EVENTS_URL)
        .bearer_auth(&tokens.access_token)
        .query(&[
            ("timeMin", time_min.as_str()),
            ("maxResults", "15"),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("showDeleted", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("Calendar request failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    if !status.is_success() {
        return Err(format!("Google Calendar error ({}): {}", status, text));
    }

    let data: EventsResponse =
        serde_json::from_str(&text).map_err(|e| format!("Invalid calendar response: {} — {}", e, text))?;

    let mut meetings = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_slots = HashSet::new();
    let mut seen_series = HashSet::new();

    for event in data.items.unwrap_or_default() {
        if meetings.len() >= limit {
            break;
        }

        if event.status.as_deref() == Some("cancelled") {
            continue;
        }

        if !is_event_upcoming(&event, now) {
            continue;
        }

        let id = event.id.as_deref().unwrap_or("").to_string();
        if id.is_empty() {
            continue;
        }
        if !seen_ids.insert(id.clone()) {
            continue;
        }

        if let Some(series_key) = event_series_key(&event) {
            if !seen_series.insert(series_key) {
                continue;
            }
        }

        let title = event
            .summary
            .as_deref()
            .unwrap_or("Untitled meeting")
            .to_string();

        let start_key = event
            .start
            .as_ref()
            .map(event_start_key)
            .unwrap_or_default();
        let slot_key = format!("{}|{}", start_key, title.to_lowercase());
        if !seen_slots.insert(slot_key) {
            continue;
        }

        let (with_whom, suggested_client_name) =
            resolve_client_name(&event, &tokens.user_email);
        let start_label = event
            .start
            .as_ref()
            .map(format_start_label)
            .unwrap_or_default();

        meetings.push(UpcomingMeeting {
            id,
            title,
            with_whom,
            suggested_client_name,
            start_label,
        });
    }

    Ok(meetings)
}

pub fn is_configured() -> bool {
    super::oauth::client_id().is_ok()
}

pub fn connection_status(app: &AppHandle) -> Result<bool, String> {
    Ok(load_tokens(app)?.is_some())
}
