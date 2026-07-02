import { getDatabase } from "./config";

export interface RealtimeSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  output_device_id: string | null;
}

export interface RealtimeSessionSummary extends RealtimeSession {
  line_count: number;
  has_speaker_labels: number;
}

export interface RealtimeTranscriptSegment {
  id: string;
  session_id: string;
  text: string;
  is_final: number;
  item_id: string | null;
  created_at: number;
  sequence_num: number;
  speaker_label?: string | null;
}

export async function createRealtimeSession(
  sessionId: string,
  outputDeviceId: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT INTO realtime_sessions (id, started_at, ended_at, output_device_id) VALUES (?, ?, NULL, ?)",
    [sessionId, Date.now(), outputDeviceId]
  );
}

export async function endRealtimeSession(sessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE realtime_sessions SET ended_at = ? WHERE id = ?",
    [Date.now(), sessionId]
  );
}

export async function saveRealtimeTranscriptSegment(params: {
  id: string;
  sessionId: string;
  text: string;
  isFinal: boolean;
  itemId?: string | null;
  sequenceNum: number;
  speakerLabel?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO realtime_transcript_segments
      (id, session_id, text, is_final, item_id, created_at, sequence_num, speaker_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.sessionId,
      params.text,
      params.isFinal ? 1 : 0,
      params.itemId ?? null,
      Date.now(),
      params.sequenceNum,
      params.speakerLabel ?? null,
    ]
  );
}

export async function getRealtimeSessionSegments(
  sessionId: string
): Promise<RealtimeTranscriptSegment[]> {
  const db = await getDatabase();
  return db.select<RealtimeTranscriptSegment[]>(
    `SELECT id, session_id, text, is_final, item_id, created_at, sequence_num, speaker_label
     FROM realtime_transcript_segments
     WHERE session_id = ?
     ORDER BY sequence_num ASC`,
    [sessionId]
  );
}

export async function listRealtimeSessions(): Promise<RealtimeSessionSummary[]> {
  const db = await getDatabase();
  return db.select<RealtimeSessionSummary[]>(
    `SELECT
       s.id,
       s.started_at,
       s.ended_at,
       s.output_device_id,
       COUNT(seg.id) AS line_count,
       MAX(
         CASE
           WHEN seg.speaker_label IS NOT NULL AND seg.speaker_label != '' THEN 1
           ELSE 0
         END
       ) AS has_speaker_labels
     FROM realtime_sessions s
     LEFT JOIN realtime_transcript_segments seg ON seg.session_id = s.id
     GROUP BY s.id
     ORDER BY s.started_at DESC`
  );
}

export async function getRealtimeSession(
  sessionId: string
): Promise<RealtimeSessionSummary | null> {
  const db = await getDatabase();
  const rows = await db.select<RealtimeSessionSummary[]>(
    `SELECT
       s.id,
       s.started_at,
       s.ended_at,
       s.output_device_id,
       COUNT(seg.id) AS line_count,
       MAX(
         CASE
           WHEN seg.speaker_label IS NOT NULL AND seg.speaker_label != '' THEN 1
           ELSE 0
         END
       ) AS has_speaker_labels
     FROM realtime_sessions s
     LEFT JOIN realtime_transcript_segments seg ON seg.session_id = s.id
     WHERE s.id = ?
     GROUP BY s.id`,
    [sessionId]
  );
  return rows[0] ?? null;
}
