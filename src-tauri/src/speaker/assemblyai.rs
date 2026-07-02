use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{error, warn};

const TARGET_SAMPLE_RATE: u32 = 16000;
const AUDIO_CHUNK_MS: u64 = 100;
const ASSEMBLYAI_WS_BASE: &str = "wss://streaming.assemblyai.com/v3/ws";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyAiConfig {
    pub api_key: String,
    #[serde(default = "default_speech_model")]
    pub speech_model: String,
    #[serde(default = "default_max_speakers")]
    pub max_speakers: u32,
}

fn default_speech_model() -> String {
    "universal-streaming-english".to_string()
}

fn default_max_speakers() -> u32 {
    5
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptDeltaPayload {
    delta: String,
    item_id: Option<String>,
    replace: bool,
    speaker_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptFinalPayload {
    transcript: String,
    item_id: Option<String>,
    speaker_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerRevisionPayload {
    turn_order: i64,
    speaker_label: Option<String>,
    transcript: Option<String>,
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

fn pcm16_to_bytes(pcm: &[i16]) -> Vec<u8> {
    pcm.iter().flat_map(|sample| sample.to_le_bytes()).collect()
}

fn build_ws_url(config: &AssemblyAiConfig) -> String {
    let max_speakers = config.max_speakers.clamp(1, 10);
    format!(
        "{}?sample_rate={}&speech_model={}&format_turns=true&speaker_labels=true&max_speakers={}",
        ASSEMBLYAI_WS_BASE, TARGET_SAMPLE_RATE, config.speech_model, max_speakers
    )
}

fn turn_item_id(turn_order: i64) -> String {
    format!("turn_{turn_order}")
}

fn speaker_label_from_event(event: &Value) -> Option<String> {
    event
        .get("speaker_label")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn handle_turn_event(app: &AppHandle, event: &Value) {
    let turn_order = event.get("turn_order").and_then(|v| v.as_i64()).unwrap_or(0);
    let item_id = turn_item_id(turn_order);
    let speaker_label = speaker_label_from_event(event);
    let transcript = event
        .get("transcript")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let end_of_turn = event
        .get("end_of_turn")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if end_of_turn {
        if transcript.is_empty() {
            return;
        }
        let _ = app.emit(
            "transcript-final",
            TranscriptFinalPayload {
                transcript,
                item_id: Some(item_id),
                speaker_label,
            },
        );
        return;
    }

    if transcript.is_empty() {
        return;
    }

    let _ = app.emit(
        "transcript-delta",
        TranscriptDeltaPayload {
            delta: transcript,
            item_id: Some(item_id),
            replace: true,
            speaker_label,
        },
    );
}

fn handle_speaker_revision(app: &AppHandle, event: &Value) {
    let Some(revisions) = event.get("revisions").and_then(|v| v.as_array()) else {
        return;
    };

    for revision in revisions {
        let turn_order = revision.get("turn_order").and_then(|v| v.as_i64());
        let Some(turn_order) = turn_order else {
            continue;
        };

        let speaker_label = revision
            .get("speaker_label")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let transcript = revision
            .get("words")
            .and_then(|words| {
                words
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|word| word.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .filter(|text| !text.is_empty())
            })
            .or_else(|| {
                revision
                    .get("transcript")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });

        let _ = app.emit(
            "transcript-speaker-revision",
            SpeakerRevisionPayload {
                turn_order,
                speaker_label,
                transcript,
            },
        );
    }
}

fn handle_ws_text_event(app: &AppHandle, text: &str, session_started: &mut bool) {
    let Ok(event) = serde_json::from_str::<Value>(text) else {
        return;
    };

    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "Begin" => {
            if !*session_started {
                *session_started = true;
                let _ = app.emit("realtime-session-started", ());
            }
        }
        "Turn" => handle_turn_event(app, &event),
        "SpeakerRevision" => handle_speaker_revision(app, &event),
        "Termination" => {}
        "error" => {
            let message = event
                .get("error")
                .and_then(|e| e.as_str())
                .or_else(|| event.get("message").and_then(|m| m.as_str()))
                .unwrap_or("Unknown AssemblyAI streaming error");
            let _ = app.emit("realtime-transcription-error", message);
            error!("AssemblyAI streaming error: {}", message);
        }
        _ => {}
    }
}

async fn connect_assemblyai_ws(
    config: &AssemblyAiConfig,
) -> Result<
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
    let url = build_ws_url(config);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket request: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "Authorization",
        config
            .api_key
            .parse()
            .map_err(|e| format!("Invalid Authorization header: {}", e))?,
    );

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("AssemblyAI WebSocket connection failed: {}", e))?;

    Ok(ws_stream.split())
}

pub async fn run_assemblyai_capture(
    app: AppHandle,
    mut stream: impl StreamExt<Item = f32> + Unpin,
    sample_rate: u32,
    config: AssemblyAiConfig,
) {
    let app_ws = app.clone();
    let ws_result: Result<(), String> = async {
        let (mut ws_write, mut ws_read) = connect_assemblyai_ws(&config).await?;
        let mut session_started = false;

        let mut append_interval = tokio::time::interval(Duration::from_millis(AUDIO_CHUNK_MS));
        append_interval.tick().await;

        let mut float_buffer: Vec<f32> = Vec::new();
        let source_chunk_size =
            ((sample_rate as u64) * AUDIO_CHUNK_MS / 1000).max(512) as usize;
        let mut stream_done = false;

        loop {
            tokio::select! {
                sample_opt = stream.next(), if !stream_done => {
                    match sample_opt {
                        Some(sample) => {
                            float_buffer.push(sample);
                            if float_buffer.len() >= source_chunk_size {
                                let chunk: Vec<f32> = float_buffer.drain(..source_chunk_size).collect();
                                let pcm = resample_to_pcm16(&chunk, sample_rate);
                                let bytes = pcm16_to_bytes(&pcm);
                                if !bytes.is_empty() {
                                    ws_write
                                        .send(Message::Binary(bytes.into()))
                                        .await
                                        .map_err(|e| format!("Failed to send audio: {}", e))?;
                                }
                            }
                        }
                        None => {
                            stream_done = true;
                            if !float_buffer.is_empty() {
                                let pcm = resample_to_pcm16(&float_buffer, sample_rate);
                                float_buffer.clear();
                                let bytes = pcm16_to_bytes(&pcm);
                                if !bytes.is_empty() {
                                    ws_write
                                        .send(Message::Binary(bytes.into()))
                                        .await
                                        .map_err(|e| format!("Failed to flush audio: {}", e))?;
                                }
                            }
                        }
                    }
                }
                _ = append_interval.tick(), if !stream_done => {
                    if float_buffer.len() >= source_chunk_size / 4 {
                        let take = float_buffer.len().min(source_chunk_size);
                        let chunk: Vec<f32> = float_buffer.drain(..take).collect();
                        let pcm = resample_to_pcm16(&chunk, sample_rate);
                        let bytes = pcm16_to_bytes(&pcm);
                        if !bytes.is_empty() {
                            ws_write
                                .send(Message::Binary(bytes.into()))
                                .await
                                .map_err(|e| format!("Failed to send audio chunk: {}", e))?;
                        }
                    }
                }
                msg = ws_read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            handle_ws_text_event(&app_ws, &text, &mut session_started);
                        }
                        Some(Ok(Message::Close(_))) => break,
                        Some(Err(e)) => return Err(format!("WebSocket read error: {}", e)),
                        None => break,
                        _ => {}
                    }
                }
            }

            if stream_done {
                break;
            }
        }

        if !float_buffer.is_empty() {
            let pcm = resample_to_pcm16(&float_buffer, sample_rate);
            let bytes = pcm16_to_bytes(&pcm);
            if !bytes.is_empty() {
                if let Err(e) = ws_write.send(Message::Binary(bytes.into())).await {
                    warn!("Failed to send trailing audio: {}", e);
                }
            }
        }

        let terminate = serde_json::json!({ "type": "Terminate" }).to_string();
        if let Err(e) = ws_write.send(Message::Text(terminate.into())).await {
            warn!("Failed to send terminate message: {}", e);
        }

        let _ = ws_write.close().await;
        Ok(())
    }
    .await;

    if let Err(err) = ws_result {
        let _ = app.emit("realtime-transcription-error", err);
    }

    let _ = app.emit("realtime-session-stopped", ());
}
