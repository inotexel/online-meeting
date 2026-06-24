import { RetrievedDocChunk } from "./types";

/** Cosine similarity floor — below this, chunks are treated as unrelated noise. */
export const MIN_DOC_RELEVANCE_SCORE = 0.75;

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
