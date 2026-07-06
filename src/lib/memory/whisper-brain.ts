import { TYPE_PROVIDER } from "@/types";

import { DialogueSpeaker } from "./dialogue";

import {

  formatSharedMeetingContext,

  MeetingAiContext,

} from "./meeting-context";

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



You hear BOTH sides of the conversation, labeled User (seller) and Client (prospect).



${VICTOR_CLOSING_PLAYBOOK}



Each turn you receive the SAME live context as the seller's "ask me anything" coach:

1. Running meeting state (summary, stage, objections, buying signals)

2. Recent labelled dialogue from this call (User and Client lines)

3. Client memory from past meetings

4. Relevant cheat-sheet / prep doc excerpts

5. One new line just transcribed



Your jobs:

A) Update meeting state using recent dialogue + the new line (always)

B) Decide if Victor should whisper RIGHT NOW — guided primarily by the uploaded cheat-sheet rules/scripts in the doc excerpts, plus client memory and this call's dialogue



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

- Default speak=false when no cheat-sheet rule, script, price line, objection handler, or close step applies to this exact moment.

- speak=true when the live moment clearly matches something in the cheat-sheet excerpts — use the doc's prescribed line or adaptation of it. The cheat sheet is the source of truth for WHEN and WHAT to say.

- Also speak when client memory from past meetings or current dialogue triggers a scripted response that appears in the cheat sheet (e.g. same objection, pricing question, guarantee ask).

- speak=false for generic coaching with no cheat-sheet backing ("listen more", "build rapport", filler encouragement).

- On User (seller) lines: speak only if they missed or contradicted a cheat-sheet rule/script that applies right now.

- One short whisper (1–2 sentences) the seller can say out loud verbatim.

- Repeating a line is fine when the cheat sheet calls for it again (e.g. client re-asks).

- why should cite which cheat-sheet rule, doc excerpt, or client-memory trigger fired.

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



function formatDialogueLineForBrain(speaker: DialogueSpeaker, text: string): string {

  const trimmed = text.trim();

  if (!trimmed) return "";

  return speaker === "user" ? `User: ${trimmed}` : `Client: ${trimmed}`;

}



export async function runWhisperBrain(params: {

  provider: TYPE_PROVIDER | undefined;

  selectedProvider: { provider: string; variables: Record<string, string> };

  meetingContext: MeetingAiContext;

  speaker: DialogueSpeaker;

  line: string;

  signal?: AbortSignal;

}): Promise<WhisperBrainResult> {

  const labeledLine = formatDialogueLineForBrain(params.speaker, params.line);

  const speakerRole = params.speaker === "user" ? "User (seller)" : "Client (prospect)";

  const userMessage = `${formatSharedMeetingContext(params.meetingContext)}



New line (${speakerRole}):

${labeledLine}`;



  const result = await collectStructuredAiText({

    provider: params.provider,

    selectedProvider: params.selectedProvider,

    systemPrompt: WHISPER_BRAIN_PROMPT,

    userMessage,

    signal: params.signal,

  });



  if (result.aborted) {

    return {

      state: params.meetingContext.brainState,

      speak: false,

      whisper: "",

      why: "",

      stage: params.meetingContext.brainState.stage,

    };

  }



  if (result.error) {

    return {

      state: params.meetingContext.brainState,

      speak: false,

      whisper: "",

      why: "",

      stage: params.meetingContext.brainState.stage,

      error: result.error,

    };

  }



  const parsed = parseBrainResponse(result.text, params.meetingContext.brainState);

  if (!parsed) {

    return {

      state: params.meetingContext.brainState,

      speak: false,

      whisper: "",

      why: "",

      stage: params.meetingContext.brainState.stage,

      error: "Could not parse whisper brain response.",

    };

  }



  return parsed;

}


