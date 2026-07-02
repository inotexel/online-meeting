import { invoke } from "@tauri-apps/api/core";
import {
  ClientGraphContext,
  MemoryExtraction,
  MemoryTextItem,
} from "./types";

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
  meetingId: string;
  utteranceId: string;
  text: string;
  speakerLabel?: string | null;
  sequenceNum: number;
}): Promise<void> {
  await invoke("knowledge_append_utterance", {
    input: {
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
  clientId: string
): Promise<ClientGraphContext> {
  try {
    const result = await invoke<{
      client_id: string;
      client_name: string;
      facts: string[];
      open_objections: string[];
      open_questions: string[];
      open_actions: string[];
      meeting_count: number;
    }>("knowledge_get_client_context", { clientId });

    return {
      clientId: result.client_id,
      clientName: result.client_name,
      facts: result.facts ?? [],
      openObjections: result.open_objections ?? [],
      openQuestions: result.open_questions ?? [],
      openActions: result.open_actions ?? [],
      meetingCount: result.meeting_count ?? 0,
    };
  } catch {
    return {
      clientId,
      clientName: clientId,
      facts: [],
      openObjections: [],
      openQuestions: [],
      openActions: [],
      meetingCount: 0,
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
    const result = await invoke<
      { client_id: string; client_name: string; meeting_count: number }[]
    >("knowledge_list_clients");
    return (result ?? []).map((row) => ({
      clientId: row.client_id,
      clientName: row.client_name,
      meetingCount: row.meeting_count ?? 0,
    }));
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
