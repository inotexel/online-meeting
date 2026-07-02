import { TYPE_PROVIDER } from "@/types";
import {
  applyMemoryToGraph,
  importSybillMeeting,
  slugifyClientId,
  sybillMeetingExists,
} from "@/lib/memory/neo4j-api";
import { extractMeetingMemory } from "@/lib/memory/extract-memory";
import {
  sybillGetConversation,
  sybillHealthCheck,
  sybillListConversations,
  SybillConversationDetail,
  SybillConversationSummary,
} from "./api";

export interface SybillSyncProgress {
  scanned: number;
  imported: number;
  skipped: number;
  message: string;
  /** Structured fields so the UI can render a meeting card. */
  action: "imported" | "skipped" | "error";
  clientName?: string;
  title?: string | null;
  meetingDate?: string | null;
  callType?: string | null;
  factCount?: number;
  /** Extracted insight text, grouped, for display in the card. */
  insights?: SybillInsight[];
}

export interface SybillInsight {
  kind: "fact" | "objection" | "question" | "action";
  text: string;
}

export interface SybillSyncResult {
  imported: number;
  skipped: number;
  scanned: number;
  clients: string[];
  errors: string[];
}

export interface SybillSyncOptions {
  apiKey: string;
  ai: {
    provider: TYPE_PROVIDER | undefined;
    selectedProvider: { provider: string; variables: Record<string, string> };
  };
  /** ISO timestamp lower bound, e.g. only last 6 months. */
  startedAfter?: string | null;
  /** Only EXTERNAL meetings by default (skip internal). */
  meetingType?: string | null;
  /** Hard cap so a first sync can't run forever. */
  maxMeetings?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SybillSyncProgress) => void;
}

const PAGE_DELAY_MS = 350;
const DETAIL_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeCrmToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable client id from Sybill CRM record (account, opportunity, etc.). */
export function sybillCrmClientId(crmType: string, crmId: string): string {
  const safeType = sanitizeCrmToken(crmType);
  const safeId = sanitizeCrmToken(crmId);
  if (!safeType || !safeId) return "";
  return `client-crm-${safeType}-${safeId}`;
}

function resolveClientDisplayName(
  summary: SybillConversationSummary,
  detail?: Pick<
    SybillConversationDetail,
    "crmName" | "suggestedClientName"
  > | null
): string {
  return (
    detail?.crmName?.trim() ||
    summary.crmName?.trim() ||
    detail?.suggestedClientName?.trim() ||
    summary.suggestedClientName?.trim() ||
    "Unknown client"
  );
}

/**
 * Pick graph client identity for a Sybill meeting.
 * Prefer stable CRM id+type; fall back to slugified company name from email domain.
 */
export function resolveSybillClientIdentity(
  summary: SybillConversationSummary,
  detail: SybillConversationDetail
): { clientId: string; clientName: string } {
  const crmId = detail.crmId?.trim() || summary.crmId?.trim() || "";
  const crmType = detail.crmType?.trim() || summary.crmType?.trim() || "";

  if (crmId && crmType) {
    const clientId = sybillCrmClientId(crmType, crmId);
    if (clientId) {
      return {
        clientId,
        clientName: resolveClientDisplayName(summary, detail),
      };
    }
  }

  const clientName = resolveClientDisplayName(summary, detail);
  return {
    clientId: slugifyClientId(clientName),
    clientName,
  };
}

/**
 * Pull recent Sybill meetings and store any that aren't already in the graph.
 * Dedup is keyed on the Sybill conversationId, so this is safe to re-run.
 */
export async function syncSybillMeetings(
  options: SybillSyncOptions
): Promise<SybillSyncResult> {
  const { apiKey, ai, signal } = options;
  const result: SybillSyncResult = {
    imported: 0,
    skipped: 0,
    scanned: 0,
    clients: [],
    errors: [],
  };

  if (!apiKey.trim()) {
    throw new Error("Sybill API key is required");
  }

  const health = await sybillHealthCheck(apiKey);
  if (!health.ok) {
    throw new Error("Sybill key did not validate (health check failed)");
  }
  if (!health.scopes.includes("read")) {
    throw new Error("Sybill API key is missing the 'read' scope");
  }

  const clientSet = new Set<string>();
  const maxMeetings = options.maxMeetings ?? 200;
  let cursor: string | null = null;

  do {
    if (signal?.aborted) break;

    const page = await sybillListConversations({
      apiKey,
      startedAfter: options.startedAfter ?? null,
      meetingType: options.meetingType ?? "EXTERNAL",
      cursor,
      limit: 50,
    });

    for (const summary of page.conversations) {
      if (signal?.aborted) break;
      if (result.imported >= maxMeetings) break;
      result.scanned += 1;

      if (!summary.conversationId) {
        result.skipped += 1;
        continue;
      }

      try {
        const exists = await sybillMeetingExists(summary.conversationId);
        if (exists) {
          result.skipped += 1;
          options.onProgress?.({
            scanned: result.scanned,
            imported: result.imported,
            skipped: result.skipped,
            action: "skipped",
            title: summary.title ?? null,
            meetingDate: summary.startTime ?? null,
            message: `Skipped (already synced): ${summary.title ?? summary.conversationId}`,
          });
          continue;
        }

        const detail = await sybillGetConversation(
          apiKey,
          summary.conversationId
        );
        await delay(DETAIL_DELAY_MS);

        const { clientId, clientName } = resolveSybillClientIdentity(
          summary,
          detail
        );
        if (!clientId) {
          result.skipped += 1;
          continue;
        }

        const meetingId = await importSybillMeeting({
          clientId,
          clientName,
          sybillId: summary.conversationId,
          title: detail.title ?? summary.title ?? null,
          callType: detail.category ?? null,
          meetingDate: detail.startTime ?? summary.startTime ?? null,
          summary: detail.summaryText || null,
        });

        const transcriptForExtraction = [detail.transcriptText, detail.summaryText]
          .filter((part) => part && part.trim())
          .join("\n\n");

        let factCount = 0;
        let insights: SybillInsight[] = [];
        if (transcriptForExtraction.trim()) {
          const memory = await extractMeetingMemory({
            provider: ai.provider,
            selectedProvider: ai.selectedProvider,
            clientName,
            recentTranscript: transcriptForExtraction.slice(0, 12000),
            existingContext: null,
            signal,
          });

          if (memory.parsed) {
            await applyMemoryToGraph(clientId, meetingId, memory.extraction);
            factCount =
              memory.extraction.new_facts.length +
              memory.extraction.new_objections.length +
              memory.extraction.new_questions.length +
              memory.extraction.new_action_items.length;
            insights = [
              ...memory.extraction.new_facts.map((i) => ({
                kind: "fact" as const,
                text: i.text,
              })),
              ...memory.extraction.new_objections.map((i) => ({
                kind: "objection" as const,
                text: i.text,
              })),
              ...memory.extraction.new_questions.map((i) => ({
                kind: "question" as const,
                text: i.text,
              })),
              ...memory.extraction.new_action_items.map((i) => ({
                kind: "action" as const,
                text: i.text,
              })),
            ];
          } else if (memory.error) {
            result.errors.push(`${clientName}: ${memory.error}`);
          }
        }

        result.imported += 1;
        clientSet.add(clientName);
        options.onProgress?.({
          scanned: result.scanned,
          imported: result.imported,
          skipped: result.skipped,
          action: "imported",
          clientName,
          title: detail.title ?? summary.title ?? null,
          meetingDate: detail.startTime ?? summary.startTime ?? null,
          callType: detail.category ?? null,
          factCount,
          insights,
          message: `Imported: ${clientName} — ${detail.title ?? "meeting"}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${summary.conversationId}: ${message}`);
      }
    }

    cursor = page.hasMore ? page.nextCursor ?? null : null;
    if (cursor) await delay(PAGE_DELAY_MS);
  } while (cursor && result.imported < maxMeetings && !signal?.aborted);

  result.clients = Array.from(clientSet);
  return result;
}
