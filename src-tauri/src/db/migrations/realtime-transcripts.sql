CREATE TABLE IF NOT EXISTS realtime_sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    output_device_id TEXT
);

CREATE TABLE IF NOT EXISTS realtime_transcript_segments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    text TEXT NOT NULL,
    is_final INTEGER NOT NULL DEFAULT 1,
    item_id TEXT,
    created_at INTEGER NOT NULL,
    sequence_num INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES realtime_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_realtime_segments_session ON realtime_transcript_segments(session_id, sequence_num ASC);
CREATE INDEX IF NOT EXISTS idx_realtime_sessions_started ON realtime_sessions(started_at DESC);
