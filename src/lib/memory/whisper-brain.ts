import { TYPE_PROVIDER } from "@/types";
import { ClientGraphContext, RetrievedDocChunk } from "./types";
import { collectStructuredAiText } from "./structured-ai";
import { VICTOR_CLOSING_PLAYBOOK } from "./victor-closing-playbook";

export type MeetingStage =
  | "opening"
  | "recap"
  | "pain_proof"
  | "projection"
  | "price_guarantee"
  | "ask_close"
  | "objection"
  | "next_steps"
  | "wrap_up"
  | "unknown";

export interface WhisperBrainState {
  summary: string;
  stage: MeetingStage;
  prospect_points: string[];
  open_objections: string[];
  buying_signals: string[];
  whispers_given: string[];
}

export const EMPTY_WHISPER_BRAIN_STATE: WhisperBrainState = {
  summary: "",
  stage: "unknown",
  prospect_points: [],
  open_objections: [],
  buying_signals: [],
  whispers_given: [],
};

export interface WhisperBrainResult {
  state: WhisperBrainState;
  speak: boolean;
  whisper: string;
  why: string;
  stage: MeetingStage;
  error?: string;
}

const STAGE_LIST =
  "opening|recap|pain_proof|projection|price_guarantee|ask_close|objection|next_steps|wrap_up|unknown";

const WHISPER_BRAIN_PROMPT = `You are Victor Dwyer's live closing coach whispering in the seller's ear during a sales close call.

You ONLY hear what the PROSPECT said (system audio). You do not hear the seller.

${VICTOR_CLOSING_PLAYBOOK}

Each turn you receive:
1. Your running meeting state from last turn
2. Client memory from past meetings (facts, objections, actions)
3. Relevant excerpts from this client's uploaded cheat sheets / prep docs (if any)
4. One new line the prospect just said

Your jobs:
A) Update the meeting state (summary, stage, prospect points, objections, buying signals)
B) Decide if there is exactly ONE high-value line Victor should say RIGHT NOW to move toward closing

Return ONLY valid JSON:
{
  "updated_state": {
    "summary": "2-4 sentence rolling recap",
    "stage": "${STAGE_LIST}",
    "prospect_points": ["key things prospect said"],
    "open_objections": ["unresolved objections"],
    "buying_signals": ["signals seen"],
    "whispers_given": ["copy previous whispers_given, append new whisper text if you speak"]
  },
  "speak": false,
  "whisper": "",
  "why": ""
}

Rules for speak:
- Default speak=false. Silence is correct most of the time.
- First match the prospect's latest line to a LIVE TRIGGER or stage in the playbook; then personalize with client doc excerpts and graph memory.
- speak=true ONLY when one specific Victor-style line would materially help close (objection, critical question, buying signal, guarantee at price, direct ask, next-step lock).
- At most one short whisper (1-2 sentences) the seller can say out loud verbatim.
- Prefer exact lines from the playbook or client doc excerpts when they fit; adapt names/numbers from client context.
- why = brief reason this helps close (shown to seller).
- Never repeat a point already in whispers_given.
- Do not whisper on small talk or filler.
- JSON only, no markdown.`;

const LEGACY_STAGE_MAP: Record<string, MeetingStage> = {
  discovery: "pain_proof",
  value: "pain_proof",
  pricing: "price_guarantee",
  closing: "ask_close",
};

function normalizeStage(value: unknown): MeetingStage {
  const s = String(value ?? "unknown").toLowerCase();
  const mapped = LEGACY_STAGE_MAP[s] ?? s;
  const allowed: MeetingStage[] = [
    "opening",
    "recap",
    "pain_proof",
    "projection",
    "price_guarantee",
    "ask_close",
    "objection",
    "next_steps",
    "wrap_up",
    "unknown",
  ];
  return allowed.includes(mapped as MeetingStage)
    ? (mapped as MeetingStage)
    : "unknown";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

function parseBrainState(raw: unknown, fallback: WhisperBrainState): WhisperBrainState {
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  return {
    summary: String(obj.summary ?? fallback.summary).trim(),
    stage: normalizeStage(obj.stage),
    prospect_points: stringList(obj.prospect_points),
    open_objections: stringList(obj.open_objections),
    buying_signals: stringList(obj.buying_signals),
    whispers_given: stringList(obj.whispers_given),
  };
}

function parseBrainResponse(
  raw: string,
  previousState: WhisperBrainState
): WhisperBrainResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  const jsonText =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? candidate.slice(jsonStart, jsonEnd + 1)
      : candidate;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const state = parseBrainState(parsed.updated_state, previousState);
    const speak = parsed.speak === true;
    const whisper = String(parsed.whisper ?? "").trim();
    const why = String(parsed.why ?? "").trim();

    return {
      state,
      speak: speak && whisper.length > 0,
      whisper,
      why,
      stage: state.stage,
    };
  } catch {
    return null;
  }
}

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
    return "(no relevant client document excerpts for this moment)";
  }
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentTitle} (relevance ${chunk.score.toFixed(2)})\n${chunk.text}`
    )
    .join("\n\n");
}

export async function runWhisperBrain(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  previousState: WhisperBrainState;
  prospectLine: string;
  clientContext?: ClientGraphContext | null;
  docChunks?: RetrievedDocChunk[];
  signal?: AbortSignal;
}): Promise<WhisperBrainResult> {
  const userMessage = `Current meeting state:
${JSON.stringify(params.previousState, null, 2)}

Client memory:
${formatClientMemory(params.clientContext)}

Client document excerpts (deal-specific cheat sheet — prefer these numbers/names/objection lines):
${formatDocExcerpts(params.docChunks ?? [])}

New prospect line:
${params.prospectLine}`;

  const result = await collectStructuredAiText({
    provider: params.provider,
    selectedProvider: params.selectedProvider,
    systemPrompt: WHISPER_BRAIN_PROMPT,
    userMessage,
    signal: params.signal,
  });

  if (result.aborted) {
    return {
      state: params.previousState,
      speak: false,
      whisper: "",
      why: "",
      stage: params.previousState.stage,
    };
  }

  if (result.error) {
    return {
      state: params.previousState,
      speak: false,
      whisper: "",
      why: "",
      stage: params.previousState.stage,
      error: result.error,
    };
  }

  const parsed = parseBrainResponse(result.text, params.previousState);
  if (!parsed) {
    return {
      state: params.previousState,
      speak: false,
      whisper: "",
      why: "",
      stage: params.previousState.stage,
      error: "Could not parse whisper brain response.",
    };
  }

  return parsed;
}
