use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{error, warn};

const TARGET_SAMPLE_RATE: u32 = 24000;
const COMMIT_INTERVAL_MS: u64 = 2500;
const APPEND_INTERVAL_MS: u64 = 100;
const MIN_COMMIT_MS: u64 = 100;
const REALTIME_WS_URL: &str = "wss://api.openai.com/v1/realtime";
const CLIENT_SECRETS_URL: &str = "https://api.openai.com/v1/realtime/client_secrets";

fn min_commit_samples() -> usize {
    (TARGET_SAMPLE_RATE as u64 * MIN_COMMIT_MS / 1000) as usize
}

async fn send_audio_append(
    ws_write: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    pcm: &[i16],
    uncommitted_samples: &mut usize,
) -> Result<(), String> {
    if pcm.is_empty() {
        return Ok(());
    }

    let payload = json!({
        "type": "input_audio_buffer.append",
        "audio": pcm16_to_base64(pcm),
    })
    .to_string();

    ws_write
        .send(Message::Text(payload.into()))
        .await
        .map_err(|e| format!("Failed to append audio: {}", e))?;

    *uncommitted_samples += pcm.len();
    Ok(())
}

async fn try_commit_audio_buffer(
    ws_write: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    uncommitted_samples: &mut usize,
) -> Result<(), String> {
    if *uncommitted_samples < min_commit_samples() {
        return Ok(());
    }

    let commit = json!({ "type": "input_audio_buffer.commit" }).to_string();
    ws_write
        .send(Message::Text(commit.into()))
        .await
        .map_err(|e| format!("Failed to commit audio buffer: {}", e))?;

    *uncommitted_samples = 0;
    Ok(())
}

async fn flush_float_buffer(
    ws_write: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    float_buffer: &mut Vec<f32>,
    sample_rate: u32,
    uncommitted_samples: &mut usize,
) -> Result<(), String> {
    if float_buffer.is_empty() {
        return Ok(());
    }

    let pcm = resample_to_pcm16(float_buffer, sample_rate);
    float_buffer.clear();
    send_audio_append(ws_write, &pcm, uncommitted_samples).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeConfig {
    #[serde(default = "default_openai_provider")]
    pub provider: String,
    pub api_key: String,
    #[serde(default = "default_openai_model")]
    pub model: String,
    #[serde(default = "default_openai_language")]
    pub language: String,
}

fn default_openai_provider() -> String {
    "openai".to_string()
}

fn default_openai_model() -> String {
    "gpt-realtime-whisper".to_string()
}

fn default_openai_language() -> String {
    "en".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptDeltaPayload {
    delta: String,
    item_id: Option<String>,
    speaker_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptFinalPayload {
    transcript: String,
    item_id: Option<String>,
    speaker_label: String,
}

fn prefix_item_id(speaker_label: &str, item_id: Option<&str>) -> Option<String> {
    item_id.map(|id| format!("{}_{}", speaker_label, id))
}

fn float_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn resample_to_pcm16(samples: &[f32], from_rate: u32) -> Vec<i16> {
    if samples.is_empty() {
        return Vec::new();
    }

    if from_rate == TARGET_SAMPLE_RATE {
        return samples.iter().map(|&s| float_to_i16(s)).collect();
    }

    let out_len =
        ((samples.len() as f64) * TARGET_SAMPLE_RATE as f64 / from_rate as f64).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f64 * from_rate as f64 / TARGET_SAMPLE_RATE as f64;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let sample = if idx + 1 < samples.len() {
            samples[idx] * (1.0 - frac) + samples[idx + 1] * frac
        } else if idx < samples.len() {
            samples[idx]
        } else {
            0.0
        };
        out.push(float_to_i16(sample));
    }

    out
}

fn pcm16_to_base64(pcm: &[i16]) -> String {
    let bytes: Vec<u8> = pcm
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    B64.encode(bytes)
}

async fn create_transcription_client_secret(
    api_key: &str,
    transcription_model: &str,
    language: &str,
) -> Result<String, String> {
    let body = json!({
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {
                        "type": "audio/pcm",
                        "rate": TARGET_SAMPLE_RATE
                    },
                    "transcription": {
                        "model": transcription_model,
                        "language": language,
                        "delay": "low"
                    },
                    "turn_detection": null
                }
            }
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(CLIENT_SECRETS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create transcription client secret: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "Unknown error".to_string());
    if !status.is_success() {
        return Err(format!(
            "Transcription client secret error ({}): {}",
            status, text
        ));
    }

    let data: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid client secret response: {}", e))?;

    data.get("value")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing client secret value in response: {}", text))
}

async fn connect_realtime_ws(auth_token: &str) -> Result<
    (
        futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
        futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ),
    String,
> {
    let mut request = REALTIME_WS_URL
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket request: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "Authorization",
        format!("Bearer {}", auth_token)
            .parse()
            .map_err(|e| format!("Invalid Authorization header: {}", e))?,
    );

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    Ok(ws_stream.split())
}

fn mark_session_ready(session_ready: &AtomicBool, event_type: &str, event: &serde_json::Value) {
    if event_type.starts_with("transcription_session.") {
        session_ready.store(true, Ordering::SeqCst);
        return;
    }

    if matches!(event_type, "session.created" | "session.updated") {
        let session_type = event
            .get("session")
            .and_then(|session| session.get("type"))
            .and_then(|value| value.as_str());

        if session_type == Some("transcription") || event_type == "session.created" {
            session_ready.store(true, Ordering::SeqCst);
        }
    }
}

fn handle_ws_text_event(
    app: &AppHandle,
    text: &str,
    session_ready: &AtomicBool,
    speaker_label: &str,
) {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "session.created" | "session.updated" | "transcription_session.created"
        | "transcription_session.updated" => {
            mark_session_ready(session_ready, event_type, &event);
        }
        "conversation.item.input_audio_transcription.delta" => {
            if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    let _ = app.emit(
                        "transcript-delta",
                        TranscriptDeltaPayload {
                            delta: delta.to_string(),
                            item_id: prefix_item_id(
                                speaker_label,
                                event.get("item_id").and_then(|v| v.as_str()),
                            ),
                            speaker_label: speaker_label.to_string(),
                        },
                    );
                }
            }
        }
        "conversation.item.input_audio_transcription.completed" => {
            if let Some(transcript) = event.get("transcript").and_then(|v| v.as_str()) {
                if !transcript.trim().is_empty() {
                    let _ = app.emit(
                        "transcript-final",
                        TranscriptFinalPayload {
                            transcript: transcript.to_string(),
                            item_id: prefix_item_id(
                                speaker_label,
                                event.get("item_id").and_then(|v| v.as_str()),
                            ),
                            speaker_label: speaker_label.to_string(),
                        },
                    );
                }
            }
        }
        "error" => {
            let message = event
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown realtime transcription error");
            // Ignore empty-buffer commit attempts; we gate commits client-side.
            if message.contains("buffer too small") {
                warn!("OpenAI realtime warning: {}", message);
                return;
            }
            let _ = app.emit("realtime-transcription-error", message);
            error!("OpenAI realtime error: {}", message);
        }
        _ => {}
    }
}

enum SessionExit {
    StreamEnded,
    Disconnected,
}

async fn run_openai_ws_session(
    app: &AppHandle,
    stream: &mut (impl StreamExt<Item = f32> + Unpin),
    stream_done: &mut bool,
    sample_rate: u32,
    config: &RealtimeConfig,
    speaker_label: &str,
    emit_session_events: bool,
) -> Result<SessionExit, String> {
    let app_ws = app.clone();
    let client_secret = create_transcription_client_secret(
        &config.api_key,
        &config.model,
        &config.language,
    )
    .await?;

    let (mut ws_write, mut ws_read) = connect_realtime_ws(&client_secret).await?;
    let session_ready = Arc::new(AtomicBool::new(false));
    let session_ready_timeout = session_ready.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if !session_ready_timeout.load(Ordering::SeqCst) {
            warn!("Transcription session ready timeout — starting audio stream");
            session_ready_timeout.store(true, Ordering::SeqCst);
        }
    });
    let mut session_started = false;

    let mut commit_interval = tokio::time::interval(Duration::from_millis(COMMIT_INTERVAL_MS));
    commit_interval.tick().await;

    let mut append_interval = tokio::time::interval(Duration::from_millis(APPEND_INTERVAL_MS));
    append_interval.tick().await;

    let mut float_buffer: Vec<f32> = Vec::new();
    let mut uncommitted_samples: usize = 0;
    let source_chunk_size = ((sample_rate as u64) * APPEND_INTERVAL_MS / 1000).max(512) as usize;

    let mut ws_closed = false;

    loop {
        if session_ready.load(Ordering::SeqCst) && !session_started {
            session_started = true;
            if !float_buffer.is_empty() {
                if flush_float_buffer(
                    &mut ws_write,
                    &mut float_buffer,
                    sample_rate,
                    &mut uncommitted_samples,
                )
                .await
                .is_err()
                {
                    return Ok(SessionExit::Disconnected);
                }
            }
            if emit_session_events {
                let _ = app_ws.emit("realtime-session-started", ());
            }
        }

        let can_stream_audio = session_ready.load(Ordering::SeqCst);

        tokio::select! {
            sample_opt = stream.next(), if !*stream_done => {
                match sample_opt {
                    Some(sample) => {
                        float_buffer.push(sample);
                        if can_stream_audio && float_buffer.len() >= source_chunk_size {
                            let chunk: Vec<f32> = float_buffer.drain(..source_chunk_size).collect();
                            let pcm = resample_to_pcm16(&chunk, sample_rate);
                            if send_audio_append(&mut ws_write, &pcm, &mut uncommitted_samples).await.is_err() {
                                return Ok(SessionExit::Disconnected);
                            }
                        }
                    }
                    None => {
                        *stream_done = true;
                        if can_stream_audio {
                            let _ = flush_float_buffer(
                                &mut ws_write,
                                &mut float_buffer,
                                sample_rate,
                                &mut uncommitted_samples,
                            ).await;
                        }
                    }
                }
            }
            _ = append_interval.tick(), if !*stream_done && can_stream_audio => {
                if float_buffer.len() >= source_chunk_size / 4 {
                    let take = float_buffer.len().min(source_chunk_size);
                    let chunk: Vec<f32> = float_buffer.drain(..take).collect();
                    let pcm = resample_to_pcm16(&chunk, sample_rate);
                    if send_audio_append(&mut ws_write, &pcm, &mut uncommitted_samples).await.is_err() {
                        return Ok(SessionExit::Disconnected);
                    }
                }
            }
            msg = ws_read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_ws_text_event(&app_ws, &text, session_ready.as_ref(), speaker_label);
                    }
                    Some(Ok(Message::Close(_))) => {
                        ws_closed = true;
                    }
                    Some(Err(e)) => {
                        warn!("WebSocket read error: {}", e);
                        ws_closed = true;
                    }
                    None => {
                        ws_closed = true;
                    }
                    _ => {}
                }
            }
            _ = commit_interval.tick(), if can_stream_audio => {
                if flush_float_buffer(
                    &mut ws_write,
                    &mut float_buffer,
                    sample_rate,
                    &mut uncommitted_samples,
                ).await.is_err() {
                    return Ok(SessionExit::Disconnected);
                }
                if let Err(e) = try_commit_audio_buffer(&mut ws_write, &mut uncommitted_samples).await {
                    warn!("{}", e);
                }
            }
        }

        if *stream_done {
            break;
        }
        if ws_closed {
            let _ = ws_write.close().await;
            return Ok(SessionExit::Disconnected);
        }
    }

    if session_ready.load(Ordering::SeqCst) {
        if let Err(e) = try_commit_audio_buffer(&mut ws_write, &mut uncommitted_samples).await {
            warn!("{}", e);
        }
    }
    let _ = ws_write.close().await;

    Ok(SessionExit::StreamEnded)
}

pub async fn run_realtime_capture(
    app: AppHandle,
    mut stream: impl StreamExt<Item = f32> + Unpin,
    sample_rate: u32,
    config: RealtimeConfig,
    speaker_label: &'static str,
    emit_session_events: bool,
) {
    let mut stream_done = false;
    let mut reconnect_attempts = 0u32;
    const MAX_RECONNECTS: u32 = 12;

    while !stream_done {
        match run_openai_ws_session(
            &app,
            &mut stream,
            &mut stream_done,
            sample_rate,
            &config,
            speaker_label,
            emit_session_events,
        )
        .await
        {
            Ok(SessionExit::StreamEnded) => break,
            Ok(SessionExit::Disconnected) => {
                reconnect_attempts += 1;
                if reconnect_attempts > MAX_RECONNECTS {
                    let _ = app.emit(
                        "realtime-transcription-error",
                        "Realtime connection lost too many times. Press Stop, then Start again.",
                    );
                    break;
                }
                warn!(
                    "OpenAI realtime disconnected ({}), reconnecting (attempt {})",
                    speaker_label, reconnect_attempts
                );
                if emit_session_events {
                    let _ = app.emit("realtime-session-reconnecting", ());
                }
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
            Err(err) => {
                let _ = app.emit("realtime-transcription-error", err);
                break;
            }
        }
    }

    if emit_session_events {
        let _ = app.emit("realtime-session-stopped", ());
    }
}
