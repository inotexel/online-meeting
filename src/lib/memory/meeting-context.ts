import { ClientGraphContext, RetrievedDocChunk } from "./types";
import { WhisperBrainState } from "./whisper-brain";

/** Recent labeled lines (User:/Client:) shared by whisper brain and meeting ask. */
export const RECENT_DIALOGUE_LINE_LIMIT = 12;

export interface MeetingAiContext {
  brainState: WhisperBrainState;
  recentDialogue: string;
  clientContext: ClientGraphContext | null;
  docChunks: RetrievedDocChunk[];
}

export function takeRecentDialogueLines(
  lines: string[],
  limit = RECENT_DIALOGUE_LINE_LIMIT
): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
    .join("\n");
}

export function formatClientMemoryForPrompt(
  context: ClientGraphContext | null | undefined
): string {
  if (!context) return "(no prior client memory)";
  return `Client: ${context.clientName}
Prior meetings: ${context.meetingCount}
Facts: ${context.facts.join("; ") || "(none)"}
Open objections: ${context.openObjections.join("; ") || "(none)"}
Open questions: ${context.openQuestions.join("; ") || "(none)"}
Open actions: ${context.openActions.join("; ") || "(none)"}`;
}

export function formatDocExcerptsForPrompt(
  chunks: RetrievedDocChunk[],
  emptyLabel = "(no relevant client document excerpts for this moment)"
): string {
  if (!chunks.length) return emptyLabel;
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentTitle} (relevance ${chunk.score.toFixed(2)})\n${chunk.text}`
    )
    .join("\n\n");
}

export function formatBrainStateForPrompt(state: WhisperBrainState): string {
  return JSON.stringify(state, null, 2);
}

export function formatRecentDialogueForPrompt(recentDialogue: string): string {
  const trimmed = recentDialogue.trim();
  return trimmed || "(no dialogue captured yet this call)";
}

/** Shared context block — same sections for whisper brain and meeting ask. */
export function formatSharedMeetingContext(ctx: MeetingAiContext): string {
  return `Live meeting state:
${formatBrainStateForPrompt(ctx.brainState)}

Recent dialogue (last ${RECENT_DIALOGUE_LINE_LIMIT} lines this call):
${formatRecentDialogueForPrompt(ctx.recentDialogue)}

Client memory:
${formatClientMemoryForPrompt(ctx.clientContext)}

Client document excerpts (cheat sheet — rules, scripts, prices, objection handlers; whisper ONLY when a rule here applies to this moment):
${formatDocExcerptsForPrompt(ctx.docChunks)}`;
}
