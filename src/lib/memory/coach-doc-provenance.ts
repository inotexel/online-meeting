import {
  filterRelevantDocChunks,
  isChunkRelevant,
  MIN_DOC_RELEVANCE_SCORE,
} from "./doc-search";
import { CoachSuggestion, RetrievedDocChunk } from "./types";

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function findChunkByTitle(
  title: string | null | undefined,
  chunks: RetrievedDocChunk[]
): RetrievedDocChunk | undefined {
  if (!title?.trim()) return undefined;
  const normalized = normalizeTitle(title);
  return (
    chunks.find((c) => normalizeTitle(c.documentTitle) === normalized) ??
    chunks.find((c) => normalizeTitle(c.documentTitle).includes(normalized)) ??
    chunks.find((c) => normalized.includes(normalizeTitle(c.documentTitle)))
  );
}

function excerptAppearsInChunk(excerpt: string, chunk: RetrievedDocChunk): boolean {
  const needle = excerpt.trim().slice(0, 80).toLowerCase();
  if (needle.length < 12) return false;
  return chunk.text.toLowerCase().includes(needle);
}

function withDocProvenance(
  suggestion: CoachSuggestion,
  chunk: RetrievedDocChunk,
  excerpt?: string | null
): CoachSuggestion {
  return {
    ...suggestion,
    fromDocSearch: true,
    sourceDocument: suggestion.sourceDocument ?? chunk.documentTitle,
    sourceExcerpt: excerpt?.trim() || chunk.text,
    docSearchScore: chunk.score,
  };
}

export function attachDocProvenance(
  suggestions: CoachSuggestion[],
  chunks: RetrievedDocChunk[]
): CoachSuggestion[] {
  const relevantChunks = filterRelevantDocChunks(chunks);
  if (!relevantChunks.length) {
    return suggestions.map((suggestion) => ({
      ...suggestion,
      fromDocSearch: false,
      sourceDocument: null,
      sourceExcerpt: null,
      docSearchScore: null,
    }));
  }

  return suggestions.map((suggestion) => {
    if (suggestion.type === "gap") {
      return { ...suggestion, fromDocSearch: false, docSearchScore: null };
    }

    if (suggestion.fromDocSearch && suggestion.sourceExcerpt?.trim()) {
      const match = relevantChunks.find((c) =>
        excerptAppearsInChunk(suggestion.sourceExcerpt!, c)
      );
      if (match) {
        return withDocProvenance(suggestion, match, suggestion.sourceExcerpt);
      }
      return {
        ...suggestion,
        fromDocSearch: false,
        sourceDocument: null,
        sourceExcerpt: null,
        docSearchScore: null,
      };
    }

    const modelExcerpt = suggestion.sourceExcerpt?.trim();
    if (modelExcerpt) {
      const match =
        findChunkByTitle(suggestion.sourceDocument, relevantChunks) ??
        relevantChunks.find((c) => excerptAppearsInChunk(modelExcerpt, c));
      if (match) {
        return withDocProvenance(suggestion, match, modelExcerpt);
      }
      return {
        ...suggestion,
        fromDocSearch: false,
        sourceDocument: null,
        sourceExcerpt: null,
        docSearchScore: null,
      };
    }

    if (suggestion.type === "cite_doc") {
      const byTitle = findChunkByTitle(suggestion.sourceDocument, relevantChunks);
      if (byTitle) {
        return withDocProvenance(suggestion, byTitle);
      }
    }

    return {
      ...suggestion,
      fromDocSearch: false,
      sourceDocument: null,
      sourceExcerpt: null,
      docSearchScore: null,
    };
  });
}

export function docChunkToSuggestion(
  chunk: RetrievedDocChunk,
  reason = "Matched your uploaded docs for the current topic."
): CoachSuggestion {
  return {
    type: "cite_doc",
    text: chunk.text.slice(0, 220),
    reason,
    sourceDocument: chunk.documentTitle,
    fromDocSearch: true,
    sourceExcerpt: chunk.text,
    docSearchScore: chunk.score,
  };
}

export { MIN_DOC_RELEVANCE_SCORE, isChunkRelevant };
