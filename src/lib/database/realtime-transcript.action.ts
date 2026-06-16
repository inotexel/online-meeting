import { getDatabase } from "./config";

export interface RealtimeSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  output_device_id: string | null;
}

export interface RealtimeTranscriptSegment {
  id: string;
  session_id: string;
  text: string;
  is_final: number;
  item_id: string | null;
  created_at: number;
  sequence_num: number;
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
}): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO realtime_transcript_segments
      (id, session_id, text, is_final, item_id, created_at, sequence_num)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.sessionId,
      params.text,
      params.isFinal ? 1 : 0,
      params.itemId ?? null,
      Date.now(),
      params.sequenceNum,
    ]
  );
}

export async function getRealtimeSessionSegments(
  sessionId: string
): Promise<RealtimeTranscriptSegment[]> {
  const db = await getDatabase();
  return db.select<RealtimeTranscriptSegment[]>(
    `SELECT id, session_id, text, is_final, item_id, created_at, sequence_num
     FROM realtime_transcript_segments
     WHERE session_id = ?
     ORDER BY sequence_num ASC`,
    [sessionId]
  );
}
