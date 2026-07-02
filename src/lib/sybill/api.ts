import { invoke } from "@tauri-apps/api/core";

export interface SybillHealth {
  ok: boolean;
  orgId?: string | null;
  scopes: string[];
}

export interface SybillParticipant {
  name?: string | null;
  email?: string | null;
}

export interface SybillConversationSummary {
  conversationId: string;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  meetingType?: string | null;
  participants: SybillParticipant[];
  crmId?: string | null;
  crmType?: string | null;
  crmName?: string | null;
  suggestedClientName?: string | null;
}

export interface SybillListResult {
  conversations: SybillConversationSummary[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface SybillConversationDetail {
  conversationId: string;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  meetingType?: string | null;
  category?: string | null;
  participants: SybillParticipant[];
  crmId?: string | null;
  crmType?: string | null;
  crmName?: string | null;
  suggestedClientName?: string | null;
  transcriptText: string;
  summaryText: string;
}

export async function sybillHealthCheck(apiKey: string): Promise<SybillHealth> {
  return invoke<SybillHealth>("sybill_health_check", { apiKey });
}

export async function sybillListConversations(params: {
  apiKey: string;
  startedAfter?: string | null;
  meetingType?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<SybillListResult> {
  return invoke<SybillListResult>("sybill_list_conversations", {
    apiKey: params.apiKey,
    startedAfter: params.startedAfter ?? null,
    meetingType: params.meetingType ?? null,
    cursor: params.cursor ?? null,
    limit: params.limit ?? 50,
  });
}

export async function sybillGetConversation(
  apiKey: string,
  conversationId: string
): Promise<SybillConversationDetail> {
  return invoke<SybillConversationDetail>("sybill_get_conversation", {
    apiKey,
    conversationId,
  });
}
