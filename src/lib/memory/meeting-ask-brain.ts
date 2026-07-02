import { TYPE_PROVIDER } from "@/types";
import { ClientGraphContext, RetrievedDocChunk } from "./types";
import { VICTOR_CLOSING_PLAYBOOK } from "./victor-closing-playbook";
import { WhisperBrainState } from "./whisper-brain";
import { collectStructuredAiText } from "./structured-ai";
import { fetchAIResponse } from "@/lib/functions";

export const MEETING_ASK_SYSTEM_PROMPT = `You are Victor Dwyer's live deal coach. The seller is on a closing call and typed a question in the app.

You have full context:
- Victor's closing playbook
- Live meeting state (stage, objections, buying signals, summary)
- Client memory from past meetings in the graph
- Relevant cheat-sheet document excerpts
- Recent prospect transcript from this call

Answer the seller's question directly. Be concise and actionable.
- If they need a line to say, give verbatim words they can speak.
- Use numbers and names from memory/docs only — never invent deal facts.
- If context is missing, say what to set up (client name, docs, etc.).

${VICTOR_CLOSING_PLAYBOOK}`;

function formatClientMemory(context: ClientGraphContext | null | undefined): string {
  if (!context) return "(no prior client memory)";
  return `Client: ${context.clientName}
Prior meetings: ${context.meetingCount}
Facts: ${context.facts.join("; ") || "(none)"}
Open objections: ${context.openObjections.join("; ") || "(none)"}
Open questions: ${context.openQuestions.join("; ") || "(none)"}
Open actions: ${context.openActions.join("; ") || "(none)"}`;
}

function formatDocExcerpts(chunks: RetrievedDocChunk[]): string {
  if (!chunks.length) {
    return "(no relevant client document excerpts)";
  }
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentTitle} (relevance ${chunk.score.toFixed(2)})\n${chunk.text}`
    )
    .join("\n\n");
}

export function buildMeetingAskUserMessage(params: {
  question: string;
  brainState: WhisperBrainState;
  clientContext?: ClientGraphContext | null;
  docChunks?: RetrievedDocChunk[];
  recentTranscript: string;
}): string {
  return `Live meeting state:
${JSON.stringify(params.brainState, null, 2)}

Client memory:
${formatClientMemory(params.clientContext)}

Client document excerpts:
${formatDocExcerpts(params.docChunks ?? [])}

Recent prospect transcript (this call):
${params.recentTranscript.trim() || "(none captured yet)"}

Seller question:
${params.question.trim()}`;
}

export async function* streamMeetingAsk(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  question: string;
  brainState: WhisperBrainState;
  clientContext?: ClientGraphContext | null;
  docChunks?: RetrievedDocChunk[];
  recentTranscript: string;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const userMessage = buildMeetingAskUserMessage(params);

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
  brainState: WhisperBrainState;
  clientContext?: ClientGraphContext | null;
  docChunks?: RetrievedDocChunk[];
  recentTranscript: string;
  signal?: AbortSignal;
}): Promise<{ answer: string; error?: string }> {
  const userMessage = buildMeetingAskUserMessage(params);
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
