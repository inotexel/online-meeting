import { ClientGraphContext, RetrievedDocChunk } from "./types";
import { WhisperBrainState } from "./whisper-brain";
import { fetchClientUtterances } from "./neo4j-api";

/** Recent labeled lines (User:/Client:) shared by whisper brain and meeting ask. */
export const RECENT_DIALOGUE_LINE_LIMIT = 12;

export interface MeetingAiContext {
  brainState: WhisperBrainState;
  recentDialogue: string;
  clientContext: ClientGraphContext | null;
  docChunks: RetrievedDocChunk[];
  /** When capturing, omit this meeting's utterances from prior-call memory. */
  activeMeetingId?: string;
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

function findKnownClientMatch(
  knownClients: { clientId: string; clientName: string; meetingCount: number }[],
  clientName: string,
  clientId: string,
  contextClientId?: string
) {
  const trimmed = clientName.trim().toLowerCase();
  const resolvedId = (contextClientId || clientId).trim();
  return knownClients.find(
    (client) =>
      (resolvedId.length > 0 && client.clientId === resolvedId) ||
      (trimmed.length > 0 && client.clientName.toLowerCase() === trimmed)
  );
}

export function mergeClientContextWithKnownClients(
  context: ClientGraphContext | null | undefined,
  clientName: string,
  clientId: string,
  knownClients: { clientId: string; clientName: string; meetingCount: number }[]
): ClientGraphContext | null {
  const listMatch = findKnownClientMatch(
    knownClients,
    clientName,
    clientId,
    context?.clientId
  );

  if (!context) {
    if (!listMatch) return null;
    return {
      clientId: listMatch.clientId || clientId,
      clientName: listMatch.clientName || clientName.trim() || clientId,
      meetingCount: listMatch.meetingCount,
      facts: [],
      openObjections: [],
      openQuestions: [],
      openActions: [],
      meetingSummaries: [],
      recentUtterances: [],
    };
  }

  if (!listMatch) return context;

  const meetingCount = Math.max(context.meetingCount, listMatch.meetingCount);
  if (meetingCount === context.meetingCount && context.clientId) {
    return context;
  }

  return {
    ...context,
    clientId: context.clientId || listMatch.clientId || clientId,
    clientName: context.clientName || listMatch.clientName || clientName.trim(),
    meetingCount,
  };
}

function speakerLabelForUtterance(speaker?: string | null): string {
  const normalized = speaker?.trim().toLowerCase();
  if (normalized === "client") return "Client";
  if (normalized === "user") return "User";
  return speaker?.trim() || "Speaker";
}

function buildTranscriptFromUtterances(
  utterances: ClientGraphContext["recentUtterances"]
): string {
  return utterances
    .map((u) => `${speakerLabelForUtterance(u.speaker)}: ${u.text.trim()}`)
    .join("\n");
}

/** Fill empty meeting summaries from utterance nodes grouped by meeting id. */
export function hydrateMeetingSummariesFromUtterances(
  context: ClientGraphContext
): ClientGraphContext {
  const utterances = context.recentUtterances ?? [];
  if (!utterances.length) return context;

  const byMeeting = new Map<string, ClientGraphContext["recentUtterances"]>();
  for (const utterance of utterances) {
    const meetingId = utterance.meetingId?.trim() || "unknown-meeting";
    const bucket = byMeeting.get(meetingId) ?? [];
    bucket.push(utterance);
    byMeeting.set(meetingId, bucket);
  }

  const summaries = [...(context.meetingSummaries ?? [])];
  const summaryByMeetingId = new Map(
    summaries
      .filter((summary) => summary.meetingId?.trim())
      .map((summary) => [summary.meetingId!.trim(), summary] as const)
  );

  for (const [meetingId, lines] of byMeeting) {
    const sorted = [...lines].sort(
      (a, b) => (a.sequenceNum ?? 0) - (b.sequenceNum ?? 0)
    );
    const transcript = buildTranscriptFromUtterances(sorted);
    const existing = summaryByMeetingId.get(meetingId);
    if (existing?.summary?.trim()) continue;

    if (existing) {
      existing.summary = transcript;
      continue;
    }

    summaries.push({
      meetingId,
      meetingNumber: null,
      title: `Meeting ${meetingId}`,
      meetingDate: null,
      summary: transcript,
    });
  }

  const meetingCount = Math.max(
    context.meetingCount,
    summaries.length,
    byMeeting.size
  );

  return {
    ...context,
    meetingSummaries: summaries,
    meetingCount,
  };
}

/** Ensure utterances + summaries are loaded before sending context to the AI. */
export async function enrichClientContextForAi(
  context: ClientGraphContext | null,
  clientId: string,
  clientName: string
): Promise<ClientGraphContext | null> {
  if (!context) return null;

  let next = context;
  if (!next.recentUtterances?.length && clientId) {
    const utterances = await fetchClientUtterances(clientId, clientName);
    if (utterances.length) {
      next = { ...next, recentUtterances: utterances };
    }
  }

  return hydrateMeetingSummariesFromUtterances(next);
}

export function formatClientMemoryForPrompt(
  context: ClientGraphContext | null | undefined,
  options?: { excludeMeetingId?: string }
): string {
  if (!context) return "(no prior client memory)";
  const excludeMeetingId = options?.excludeMeetingId?.trim();

  const priorMeetingsOnRecord =
    context.meetingCount > 0
      ? `Yes — ${context.meetingCount} prior meeting(s) recorded in Neo4j for this client.`
      : "No prior meetings recorded in Neo4j yet.";

  const meetingHistoryBanner =
    context.meetingCount > 0
      ? `HISTORY CONFIRMED: ${context.meetingCount} prior meeting(s) on file for ${context.clientName}. Do not describe this as a first call.`
      : "";

  const meetings =
    context.meetingSummaries?.length
      ? context.meetingSummaries
          .map((m, index) => {
            const parts = [
              m.title?.trim(),
              m.meetingDate?.trim() ? `(${m.meetingDate.trim()})` : "",
            ].filter(Boolean);
            const header = parts.length
              ? parts.join(" ")
              : `Meeting ${m.meetingNumber ?? index + 1}`;
            const summary = m.summary?.trim();
            if (summary) {
              const looksLikeTranscript =
                summary.includes("Client:") || summary.includes("User:");
              return looksLikeTranscript
                ? `${header} — transcript:\n${summary}`
                : `${header}: ${summary}`;
            }
            return `${header} (captured — no summary stored yet)`;
          })
          .join("\n\n")
      : context.meetingCount > 0
        ? `${context.meetingCount} meeting(s) linked in graph (no summary metadata stored yet)`
        : "(none)";

  const priorUtterances =
    context.recentUtterances
      ?.filter(
        (u) =>
          !excludeMeetingId ||
          !u.meetingId?.trim() ||
          u.meetingId.trim() !== excludeMeetingId
      )
      .slice()
      .sort((a, b) => {
        if (a.createdAt && b.createdAt) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        return (a.sequenceNum ?? 0) - (b.sequenceNum ?? 0);
      })
      .map((u) => {
        const label =
          u.speaker?.trim().toLowerCase() === "client"
            ? "Client"
            : u.speaker?.trim().toLowerCase() === "user"
              ? "User"
              : u.speaker?.trim() || "Speaker";
        return `${label}: ${u.text.trim()}`;
      })
      .join("\n") || "(none)";

  const hasTranscript = priorUtterances !== "(none)";
  const transcriptNote = hasTranscript
    ? "Use these lines for continuity (pricing, objections, tone, etc.). Meeting summaries above may also contain full call transcripts."
    : context.meetingCount > 0
      ? "No separate utterance nodes found — check meeting summaries above for stored transcripts. Do NOT claim this is a brand-new client."
      : "No prior call dialogue in graph yet.";

  return `${meetingHistoryBanner ? `${meetingHistoryBanner}\n` : ""}Client: ${context.clientName} (graph id: ${context.clientId})
Prior meetings on record: ${priorMeetingsOnRecord}
Prior meeting summaries (from graph — may include Sybill imports):
${meetings}
Prior meeting transcript (what was actually said in past calls):
${priorUtterances}
Transcript note: ${transcriptNote}
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
${formatClientMemoryForPrompt(ctx.clientContext, {
  excludeMeetingId: ctx.activeMeetingId,
})}

Client document excerpts (cheat sheet — rules, facts, scripts, prices, objection handlers; apply when topic-relevant, not only on exact quote match):
${formatDocExcerptsForPrompt(ctx.docChunks)}`;
}
