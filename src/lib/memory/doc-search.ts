import { RetrievedDocChunk } from "./types";

/** Strict floor for legacy coach paths that require high-confidence doc hits. */
export const MIN_DOC_RELEVANCE_SCORE = 0.75;

/** Looser floor for live whispers and meeting ask — rules docs often score lower. */
export const WHISPER_MIN_DOC_RELEVANCE_SCORE = 0.55;

/** @deprecated Use WHISPER_MIN_DOC_RELEVANCE_SCORE — kept as alias for meeting ask. */
export const ASK_MIN_DOC_RELEVANCE_SCORE = WHISPER_MIN_DOC_RELEVANCE_SCORE;

export function buildDocSearchQuery(transcript: string): string {
  const trimmed = transcript.trim();
  if (!trimmed) return "";

  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const recentLines = lines.slice(-5).join("\n");

  return (recentLines || trimmed).slice(-480).trim();
}

export function filterRelevantDocChunks(
  chunks: RetrievedDocChunk[],
  minScore = MIN_DOC_RELEVANCE_SCORE
): RetrievedDocChunk[] {
  return chunks.filter((chunk) => chunk.score >= minScore);
}

export function isChunkRelevant(
  chunk: RetrievedDocChunk | undefined,
  minScore = MIN_DOC_RELEVANCE_SCORE
): boolean {
  return Boolean(chunk && chunk.score >= minScore);
}

/** Question-first query for meeting ask — seller intent beats transcript tail. */
export function buildMeetingAskDocSearchQuery(
  question: string,
  transcript?: string
): string {
  const q = question.trim();
  const t = transcript?.trim() ?? "";
  if (!q && !t) return "";
  if (q && t) {
    return `${q}\n\n${buildDocSearchQuery(t)}`.slice(0, 800).trim();
  }
  return q || buildDocSearchQuery(t);
}

/** Pick doc chunks for ask — looser threshold, then fall back to best matches. */
export function selectDocChunksForAsk(
  chunks: RetrievedDocChunk[]
): RetrievedDocChunk[] {
  return selectDocChunksForWhisper(chunks);
}

/** Pick doc chunks for live whispers — thematic rules often sit below 0.75. */
export function selectDocChunksForWhisper(
  chunks: RetrievedDocChunk[],
  fallbackCount = 3
): RetrievedDocChunk[] {
  const filtered = filterRelevantDocChunks(
    chunks,
    WHISPER_MIN_DOC_RELEVANCE_SCORE
  );
  if (filtered.length > 0) return filtered;
  return [...chunks].sort((a, b) => b.score - a.score).slice(0, fallbackCount);
}
