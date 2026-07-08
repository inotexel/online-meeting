import { TYPE_PROVIDER } from "@/types";
import { VICTOR_CLOSING_PLAYBOOK } from "./victor-closing-playbook";
import { formatSharedMeetingContext, MeetingAiContext } from "./meeting-context";
import { collectStructuredAiText } from "./structured-ai";
import { fetchAIResponse } from "@/lib/functions";

export const MEETING_ASK_SYSTEM_PROMPT = `You are Victor Dwyer's live deal coach. The seller typed a question in the app — before, during, or after a closing call.

You receive the SAME context as the automatic whisper coach:
- Victor's closing playbook
- Live meeting state (stage, objections, buying signals, summary)
- Recent labelled dialogue from this call (User and Client) — empty if the call has not started
- Client memory from past meetings in the graph (summaries, facts, objections, questions, actions, AND prior meeting transcript lines — what the client and seller actually said before)
- Relevant cheat-sheet document excerpts for this client

Before the call starts: answer from prior meeting transcript + client memory + cheat-sheet docs + playbook.
During the call: also use live dialogue and meeting state; do not repeat lines already in "Recent dialogue this call".

When the client asked about pricing, objections, or next steps in a prior meeting, reference that history — do not say there was no prior conversation if transcript lines exist.

CRITICAL — read "Prior meetings on record" in Client memory:
- If it says "Yes — N prior meeting(s)" (N > 0), this is NOT a first call. Never say "no prior meetings", "no prior conversations", "starting fresh", "first encounter", or "never met before".
- The UI may show the same client with N meetings in Neo4j — trust "Prior meetings on record" over your assumptions.
- If transcript is "(none)" but meetings exist, read **Prior meeting summaries** — they may contain full call transcripts. Say prior meetings exist but dialogue/summaries were not loaded yet — do NOT claim zero meetings.
- Only treat as a first call when prior meetings on record says "No prior meetings recorded".

Answer the seller's question directly. Be concise and actionable.
- If they need a line to say, give verbatim words they can speak.
- Use numbers and names from memory/docs only — never invent deal facts.
- When you use a fact, briefly note if it came from prior meetings, uploaded docs, or this call's dialogue.
- If context is missing, say what to set up (client name, docs, Neo4j, etc.).

${VICTOR_CLOSING_PLAYBOOK}`;

export function buildMeetingAskUserMessage(params: {
  question: string;
  meetingContext: MeetingAiContext;
}): string {
  return `${formatSharedMeetingContext(params.meetingContext)}

Seller question:
${params.question.trim()}`;
}

export async function* streamMeetingAsk(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  question: string;
  meetingContext: MeetingAiContext;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const userMessage = buildMeetingAskUserMessage({
    question: params.question,
    meetingContext: params.meetingContext,
  });

  for await (const chunk of fetchAIResponse({
    provider: params.provider,
    selectedProvider: params.selectedProvider,
    systemPrompt: MEETING_ASK_SYSTEM_PROMPT,
    userMessage,
    history: [],
    imagesBase64: [],
    signal: params.signal,
    enhanceSystemPrompt: false,
  })) {
    yield chunk;
  }
}

export async function runMeetingAsk(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  question: string;
  meetingContext: MeetingAiContext;
  signal?: AbortSignal;
}): Promise<{ answer: string; error?: string }> {
  const userMessage = buildMeetingAskUserMessage({
    question: params.question,
    meetingContext: params.meetingContext,
  });
  const result = await collectStructuredAiText({
    provider: params.provider,
    selectedProvider: params.selectedProvider,
    systemPrompt: MEETING_ASK_SYSTEM_PROMPT,
    userMessage,
    signal: params.signal,
  });

  if (result.aborted) {
    return { answer: "" };
  }
  if (result.error) {
    return { answer: "", error: result.error };
  }
  return { answer: result.text };
}
