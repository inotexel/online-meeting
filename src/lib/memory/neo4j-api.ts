import { invoke } from "@tauri-apps/api/core";
import {
  ClientGraphContext,
  MeetingSummarySnippet,
  MemoryExtraction,
  MemoryTextItem,
  UtteranceSnippet,
} from "./types";
function readString(
  row: Record<string, unknown>,
  camel: string,
  snake: string
): string {
  const value = row[camel] ?? row[snake];
  return typeof value === "string" ? value : "";
}

function readNumber(
  row: Record<string, unknown>,
  camel: string,
  snake: string
): number {
  const value = row[camel] ?? row[snake];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readOptionalNumber(
  row: Record<string, unknown>,
  camel: string,
  snake: string
): number | null {
  const value = row[camel] ?? row[snake];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMeetingSummaries(raw: unknown): MeetingSummarySnippet[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    return {
      meetingId: readString(row, "meetingId", "meeting_id") || readString(row, "id", "id") || null,
      meetingNumber: typeof row.number === "number" ? row.number : null,
      title: readString(row, "title", "title") || null,
      meetingDate: readString(row, "date", "date") || null,
      summary: readString(row, "summary", "summary") || null,
    };
  });
}

function parseUtteranceSnippets(raw: unknown): UtteranceSnippet[] {
  if (!Array.isArray(raw)) return [];
  const snippets: UtteranceSnippet[] = [];
  for (const item of raw) {
    const row =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    const text = readString(row, "text", "text");
    if (!text) continue;
    snippets.push({
      meetingId: readString(row, "meetingId", "meeting_id") || null,
      speaker: readString(row, "speaker", "speaker") || null,
      text,
      sequenceNum: readOptionalNumber(row, "sequenceNum", "sequence_num"),
      createdAt: readString(row, "createdAt", "created_at") || null,
    });
  }
  return snippets;
}

function parseClientGraphContext(
  result: Record<string, unknown>,
  fallbackId: string,
  fallbackName?: string
): ClientGraphContext {
  return {
    clientId: readString(result, "clientId", "client_id") || fallbackId,
    clientName:
      readString(result, "clientName", "client_name") ||
      fallbackName?.trim() ||
      fallbackId,
    facts: Array.isArray(result.facts)
      ? result.facts.map(String).filter(Boolean)
      : [],
    openObjections: Array.isArray(result.openObjections)
      ? result.openObjections.map(String).filter(Boolean)
      : Array.isArray(result.open_objections)
        ? result.open_objections.map(String).filter(Boolean)
        : [],
    openQuestions: Array.isArray(result.openQuestions)
      ? result.openQuestions.map(String).filter(Boolean)
      : Array.isArray(result.open_questions)
        ? result.open_questions.map(String).filter(Boolean)
        : [],
    openActions: Array.isArray(result.openActions)
      ? result.openActions.map(String).filter(Boolean)
      : Array.isArray(result.open_actions)
        ? result.open_actions.map(String).filter(Boolean)
        : [],
    meetingCount: readNumber(result, "meetingCount", "meeting_count"),
    meetingSummaries: parseMeetingSummaries(
      result.meetingSummaries ?? result.meeting_summaries
    ),
    recentUtterances: parseUtteranceSnippets(
      result.recentUtterances ?? result.recent_utterances
    ),
  };
}

export async function fetchClientUtterances(
  clientId: string,
  clientName?: string
): Promise<UtteranceSnippet[]> {
  try {
    const result = await invoke<unknown>("knowledge_fetch_client_utterances", {
      clientId,
      clientName: clientName?.trim() ?? null,
    });
    return parseUtteranceSnippets(result);
  } catch (error) {
    console.error("fetchClientUtterances failed:", error);
    return [];
  }
}

export async function isKnowledgeConfigured(): Promise<boolean> {
  try {
    return await invoke<boolean>("knowledge_is_configured");
  } catch {
    return false;
  }
}

export async function testKnowledgeConnection(): Promise<string> {
  return invoke<string>("knowledge_test_connection");
}

export async function startMeetingGraph(params: {
  clientId: string;
  clientName: string;
  meetingId: string;
  meetingNumber?: number;
}): Promise<void> {
  await invoke("knowledge_start_meeting_graph", {
    input: {
      clientId: params.clientId,
      clientName: params.clientName,
      meetingId: params.meetingId,
      meetingNumber: params.meetingNumber ?? null,
    },
  });
}

export async function endMeetingGraph(
  meetingId: string,
  summary?: string
): Promise<void> {
  await invoke("knowledge_end_meeting_graph", {
    meetingId,
    summary: summary ?? null,
  });
}

export async function appendUtteranceToGraph(params: {
  clientId: string;
  clientName?: string;
  meetingId: string;
  utteranceId: string;
  text: string;
  speakerLabel?: string | null;
  sequenceNum: number;
}): Promise<void> {
  await invoke("knowledge_append_utterance", {
    input: {
      clientId: params.clientId,
      clientName: params.clientName ?? null,
      meetingId: params.meetingId,
      utteranceId: params.utteranceId,
      text: params.text,
      speakerLabel: params.speakerLabel ?? null,
      sequenceNum: params.sequenceNum,
    },
  });
}

export function scopeMemoryItemId(clientId: string, id: string): string {
  const prefix = `${clientId}:`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function scopeMemoryItems(
  clientId: string,
  items: MemoryTextItem[]
): MemoryTextItem[] {
  return items.map((item) => ({
    ...item,
    id: scopeMemoryItemId(clientId, item.id),
  }));
}

export function scopeMemoryExtraction(
  clientId: string,
  extraction: MemoryExtraction
): MemoryExtraction {
  return {
    new_facts: scopeMemoryItems(clientId, extraction.new_facts),
    new_objections: scopeMemoryItems(clientId, extraction.new_objections),
    new_questions: scopeMemoryItems(clientId, extraction.new_questions),
    new_action_items: scopeMemoryItems(clientId, extraction.new_action_items),
    updated_objections: scopeMemoryItems(clientId, extraction.updated_objections),
  };
}

export async function applyMemoryToGraph(
  clientId: string,
  meetingId: string,
  extraction: MemoryExtraction
): Promise<void> {
  const scoped = scopeMemoryExtraction(clientId, extraction);
  await invoke("knowledge_apply_memory", {
    input: {
      clientId,
      meetingId,
      newFacts: scoped.new_facts,
      newObjections: scoped.new_objections,
      newQuestions: scoped.new_questions,
      newActionItems: scoped.new_action_items,
      updatedObjections: scoped.updated_objections,
    },
  });
}

export async function getClientGraphContext(
  clientId: string,
  clientName?: string
): Promise<ClientGraphContext> {
  try {
    const result = await invoke<Record<string, unknown>>(
      "knowledge_get_client_context",
      {
        clientId,
        clientName: clientName?.trim() ?? null,
      }
    );

    return parseClientGraphContext(result, clientId, clientName);
  } catch (error) {
    console.error("getClientGraphContext failed:", error);
    return {
      clientId,
      clientName: clientName?.trim() || clientId,
      facts: [],
      openObjections: [],
      openQuestions: [],
      openActions: [],
      meetingCount: 0,
      meetingSummaries: [],
      recentUtterances: [],
    };
  }
}

export interface KnownClient {
  clientId: string;
  clientName: string;
  meetingCount: number;
}

export async function listKnownClients(): Promise<KnownClient[]> {
  try {
    const result = await invoke<Record<string, unknown>[]>(
      "knowledge_list_clients"
    );
    return (result ?? [])
      .map((row) => ({
        clientId: readString(row, "clientId", "client_id"),
        clientName: readString(row, "clientName", "client_name"),
        meetingCount: readNumber(row, "meetingCount", "meeting_count"),
      }))
      .filter((row) => row.clientId.length > 0);
  } catch {
    return [];
  }
}

export async function sybillMeetingExists(sybillId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("knowledge_sybill_meeting_exists", {
      sybillId,
    });
  } catch {
    return false;
  }
}

export async function importSybillMeeting(params: {
  clientId: string;
  clientName: string;
  sybillId: string;
  title?: string | null;
  callType?: string | null;
  meetingDate?: string | null;
  summary?: string | null;
}): Promise<string> {
  return invoke<string>("knowledge_import_sybill_meeting", {
    input: {
      clientId: params.clientId,
      clientName: params.clientName,
      sybillId: params.sybillId,
      title: params.title ?? null,
      callType: params.callType ?? null,
      meetingDate: params.meetingDate ?? null,
      summary: params.summary ?? null,
    },
  });
}

export function slugifyClientId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `client-${slug}` : "";
}

export function newMemoryItem(prefix: string, text: string): MemoryTextItem {
  return {
    id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    status: "open",
  };
}
