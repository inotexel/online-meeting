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

3. Client memory from past meetings — including prior meeting transcript (what they actually said before), summaries, facts, objections, questions, actions

4. Cheat-sheet / prep doc excerpts (rules, facts, scripts — not a fixed call script)

5. One new line just transcribed



Your jobs:

A) Update meeting state using recent dialogue + the new line (always)

B) Decide if Victor should whisper RIGHT NOW — what is the best concrete line the seller could say out loud next?



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

- Cadence: at most ONE whisper per prospect turn. A prospect turn ends when they pause and the seller could reply. If you already whispered for this turn (check whispers_given + recent Client lines), prefer speak=false unless they raised a NEW objection, price question, or buying signal.

- After each new line, ask: "What is the best next thing the seller could say out loud?" speak=true only when you have a concrete 1–2 sentence line AND the moment is actionable. Dialogue and stage drive TIMING; cheat sheet and client memory drive FACTS and constraints.

- speak=true when ANY of these apply (and cadence allows):

  • Client raised a substantive objection, stall, price/budget question, buying signal, confusion, or tangent worth redirecting

  • Seller missed close discipline (no guarantee at price, undersold, talked past the ask, weak filler, wrong stage move) — still prefer speak=false if you already coached on this point recently

  • The close sequence suggests a natural next move for the current stage — conversations can jump stages; follow what was just said, not a rigid script order

  • Client memory or doc excerpts supply numbers, names, or rules that should shape the whisper for this topic

  • Prior meeting transcript shows the client already asked or objected about something (e.g. price) — weave continuity into the whisper; never ignore that history

  • "Prior meetings on record" says Yes with N > 0 — this is NOT a first call; never whisper as if they are a brand-new prospect even if transcript is empty

- Cheat sheet usage: treat excerpts as RULES and FACTS, not a branching script. You do NOT need an exact quote match. If a rule applies (e.g. always pair price with guarantee), speak even when wording comes from the playbook. Prefer doc numbers/names when the topic overlaps; otherwise use playbook + live dialogue.

- speak=false when:

  • Nothing actionable changed (filler: "yeah", "okay", "mm-hmm", hold music)

  • The new line mostly repeats or extends the previous Client line without a new ask or objection

  • You would only give vague encouragement with no next line ("listen more", "build rapport", "good job")

  • The exact same whisper is already in whispers_given AND the prospect did not re-raise the same blocker

  • You would whisper on back-to-back lines — wait for a clear new moment instead

- On User (seller) lines: update state always. speak=true ONLY when they should emphasize something more OR say it differently — stronger framing, add the guarantee with price, assumptive close, cut filler/undersell. The whisper is a better version of what they just said (1–2 sentences). speak=false if their line was fine, only trivial wording differences, or you have nothing concrete to improve.

- On Client (prospect) lines: speak=true for the best next line the seller should say to the prospect (objection, stall, close move, etc.).

- One short whisper (1–2 sentences) the seller can say out loud verbatim.

- Repeating a line is fine when the client re-asks or the same objection resurfaces.

- why: cite the trigger — stage move, prospect signal, playbook rule, cheat-sheet fact, or client memory (not "chunk matched").

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


