import { TYPE_PROVIDER } from "@/types";
import { VICTOR_CLOSING_PLAYBOOK } from "./victor-closing-playbook";
import { formatSharedMeetingContext, MeetingAiContext } from "./meeting-context";
import { collectStructuredAiText } from "./structured-ai";
import { fetchAIResponse } from "@/lib/functions";

export const MEETING_ASK_SYSTEM_PROMPT = `You are Victor Dwyer's live deal coach. The seller is on a closing call and typed a question in the app.

You receive the SAME live context as the automatic whisper coach:
- Victor's closing playbook
- Live meeting state (stage, objections, buying signals, summary)
- Recent labelled dialogue from this call (User and Client)
- Client memory from past meetings in the graph
- Relevant cheat-sheet document excerpts

Answer the seller's question directly. Be concise and actionable.
- If they need a line to say, give verbatim words they can speak.
- Use numbers and names from memory/docs only — never invent deal facts.
- If context is missing, say what to set up (client name, docs, etc.).

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
