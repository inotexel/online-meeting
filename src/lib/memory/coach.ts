import { TYPE_PROVIDER } from "@/types";
import {
  attachDocProvenance,
  isChunkRelevant,
} from "./coach-doc-provenance";
import { filterRelevantDocChunks } from "./doc-search";
import { collectStructuredAiText } from "./structured-ai";
import {
  ClientGraphContext,
  CoachResponse,
  CoachSuggestion,
  RetrievedDocChunk,
} from "./types";

const COACH_PROMPT = `You are a proactive live sales call coach. Your job is to help the user during the call — do not stay silent when there is anything useful to say.

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "type": "answer",
      "text": "What to say or do next",
      "reason": "Why this helps right now",
      "sourceDocument": "Document title or null",
      "sourceExcerpt": "Exact quote from a document excerpt below, or null",
      "sourceChunkIndex": 1
    }
  ]
}

Allowed types: answer, question, expect, reminder, cite_doc, gap

Rules:
- ALWAYS return at least 1 suggestion (up to 3) whenever the transcript contains real speech about the meeting, product, client, pricing, timeline, security, competitors, or next steps.
- Be helpful and slightly proactive — suggest what to say, ask, or prepare for based on the latest transcript, memory, and document excerpts.
- When a suggestion uses uploaded document excerpts, set sourceDocument, sourceExcerpt (verbatim quote from that chunk), and sourceChunkIndex (the [n] number from the excerpt list).
- Use cite_doc when the main value is pointing at a document fact; use answer when paraphrasing doc content into what to say.
- Use gap when the client raised a topic not in docs (say what is missing, do not invent facts).
- ONLY cite documents when the excerpt list contains material directly relevant to the CURRENT transcript topic. If excerpts are unrelated, ignore them — leave sourceDocument, sourceExcerpt, and sourceChunkIndex null.
- Do not cite the same document chunk every cycle unless it still matches what is being discussed right now.
- Only return an empty suggestions array if the transcript is pure filler with no substantive content.
- Prefer short, actionable text the user can say out loud.
- JSON only, no markdown.

Transcript format:
- Lines prefixed "User:" are what the salesperson (Pluely user) said on the mic.
- Lines prefixed "Client:" are what the other party said on the call (meeting audio).
- The client name at the top of the message is the account/person for this meeting, not a transcript line.`;

async function collectAiText(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await collectStructuredAiText(params);
  if (result.error) {
    throw new Error(result.error);
  }
  return result.text;
}

function normalizeRawSuggestion(
  raw: Record<string, unknown>,
  chunks: RetrievedDocChunk[]
): CoachSuggestion {
  const sourceChunkIndex =
    typeof raw.source_chunk_index === "number"
      ? raw.source_chunk_index
      : typeof raw.sourceChunkIndex === "number"
        ? raw.sourceChunkIndex
        : null;

  const chunkFromIndex =
    sourceChunkIndex && sourceChunkIndex >= 1
      ? chunks[sourceChunkIndex - 1]
      : undefined;

  const modelExcerpt =
    (typeof raw.source_excerpt === "string" ? raw.source_excerpt : null) ??
    (typeof raw.sourceExcerpt === "string" ? raw.sourceExcerpt : null);

  const modelDocument =
    (typeof raw.sourceDocument === "string" ? raw.sourceDocument : null) ??
    (typeof raw.source_document === "string" ? raw.source_document : null);

  const type = (raw.type as CoachSuggestion["type"]) ?? "reminder";

  const relevantChunk =
    chunkFromIndex && isChunkRelevant(chunkFromIndex)
      ? chunkFromIndex
      : undefined;

  const fromDocSearch = Boolean(
    relevantChunk &&
      (type === "cite_doc" ||
        (modelExcerpt?.trim() &&
          relevantChunk.text
            .toLowerCase()
            .includes(modelExcerpt.trim().slice(0, 40).toLowerCase())))
  );

  return {
    type,
    text: String(raw.text ?? ""),
    reason: String(raw.reason ?? ""),
    sourceDocument: fromDocSearch
      ? modelDocument ?? relevantChunk?.documentTitle ?? null
      : null,
    sourceExcerpt: fromDocSearch
      ? modelExcerpt ?? (type === "cite_doc" ? relevantChunk?.text : null) ?? null
      : null,
    fromDocSearch,
    docSearchScore: fromDocSearch ? relevantChunk?.score ?? null : null,
  };
}

function parseCoachResponse(
  raw: string,
  chunks: RetrievedDocChunk[]
): CoachResponse {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  const jsonText =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? candidate.slice(jsonStart, jsonEnd + 1)
      : candidate;

  try {
    const parsed = JSON.parse(jsonText) as {
      suggestions?: Array<Record<string, unknown>>;
    };
    const suggestions = (parsed.suggestions ?? [])
      .slice(0, 3)
      .map((item) => normalizeRawSuggestion(item, chunks))
      .filter((item) => item.text.trim().length > 0);
    if (suggestions.length > 0) {
      return { stepIn: true, suggestions };
    }
    // Legacy step_in:false with no cards — treat as empty
    return { stepIn: false, suggestions: [] };
  } catch {
    if (trimmed.length > 0) {
      return {
        stepIn: true,
        suggestions: [
          {
            type: "reminder",
            text: trimmed.slice(0, 280),
            reason: "Coach returned plain text instead of JSON.",
          },
        ],
      };
    }
    return { stepIn: false, suggestions: [] };
  }
}


function finalizeCoachResponse(
  response: CoachResponse,
  chunks: RetrievedDocChunk[]
): CoachResponse {
  return {
    ...response,
    suggestions: attachDocProvenance(response.suggestions, chunks),
  };
}

function formatDocExcerpts(chunks: RetrievedDocChunk[]): string {
  if (!chunks.length) {
    return "(no document excerpts met the relevance threshold for this topic)";
  }
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentTitle} (relevance ${chunk.score.toFixed(2)})\n${chunk.text}`
    )
    .join("\n\n");
}

export async function generateCoachSuggestions(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  clientContext: ClientGraphContext;
  recentTranscript: string;
  docChunks?: RetrievedDocChunk[];
  signal?: AbortSignal;
}): Promise<CoachResponse> {
  if (!params.recentTranscript.trim()) {
    return { stepIn: false, suggestions: [] };
  }

  const docChunks = filterRelevantDocChunks(params.docChunks ?? []);

  const userMessage = `Client: ${params.clientContext.clientName}
Meeting number: ${params.clientContext.meetingCount + 1}

Known facts:
${params.clientContext.facts.join("\n") || "(none)"}

Open objections:
${params.clientContext.openObjections.join("\n") || "(none)"}

Open questions:
${params.clientContext.openQuestions.join("\n") || "(none)"}

Open actions:
${params.clientContext.openActions.join("\n") || "(none)"}

Relevant document excerpts:
${formatDocExcerpts(docChunks)}

Recent meeting transcript:
${params.recentTranscript}`;

  try {
    const raw = await collectAiText({
      provider: params.provider,
      selectedProvider: params.selectedProvider,
      systemPrompt: COACH_PROMPT,
      userMessage,
      signal: params.signal,
    });
    if (!raw) {
      return {
        stepIn: false,
        suggestions: [],
        error: "AI returned an empty response. Check your provider API key in Dev Space.",
      };
    }
    const parsed = parseCoachResponse(raw, docChunks);
    if (parsed.suggestions.length === 0 && params.recentTranscript.trim().length > 20) {
      return {
        stepIn: true,
        suggestions: [
          {
            type: "question",
            text: "What would make this a clear win for you in the next 90 days?",
            reason:
              "Keeps the conversation moving when the model returned no cards.",
            fromDocSearch: false,
          },
        ],
      };
    }
    return finalizeCoachResponse(parsed, docChunks);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error("Coach generation failed:", error);
    return { stepIn: false, suggestions: [], error: message };
  }
}
