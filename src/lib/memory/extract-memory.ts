import {
  ClientGraphContext,
  EMPTY_MEMORY_EXTRACTION,
  MemoryExtraction,
} from "./types";
import { collectStructuredAiText } from "./structured-ai";

const MEMORY_EXTRACTION_PROMPT = `You extract structured sales meeting memory from transcript text.

Return ONLY valid JSON with this exact shape:
{
  "new_facts": [{"id": "fact_1", "text": "..."}],
  "new_objections": [{"id": "obj_1", "text": "...", "status": "open"}],
  "new_questions": [{"id": "q_1", "text": "...", "status": "open"}],
  "new_action_items": [{"id": "act_1", "text": "...", "status": "open"}],
  "updated_objections": [{"id": "obj_existing", "text": "...", "status": "resolved"}]
}

Rules:
- Only include NEW or UPDATED items from the latest transcript window.
- Do not repeat items already listed in current memory unless status changed.
- Keep text short and factual.
- Use stable ids: fact_*, obj_*, q_*, act_* with short suffixes.
- If nothing new, return exactly: {"new_facts":[],"new_objections":[],"new_questions":[],"new_action_items":[],"updated_objections":[]}
- No markdown, no explanation, JSON only.`;

export type ExtractMemoryResult = {
  extraction: MemoryExtraction;
  /** True when the model returned parseable JSON (even if all arrays are empty). */
  parsed: boolean;
  error?: string;
};

function normalizeMemoryItems(value: unknown): MemoryExtraction["new_facts"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object")
    )
    .map((item) => ({
      id: String(item.id ?? ""),
      text: String(item.text ?? "").trim(),
      status: item.status != null ? String(item.status) : undefined,
    }))
    .filter((item) => item.id && item.text);
}

function parseMemoryExtraction(raw: string): MemoryExtraction | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (!candidate) return null;

  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  const jsonText =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? candidate.slice(jsonStart, jsonEnd + 1)
      : candidate;

  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      new_facts: normalizeMemoryItems(parsed.new_facts),
      new_objections: normalizeMemoryItems(parsed.new_objections),
      new_questions: normalizeMemoryItems(parsed.new_questions),
      new_action_items: normalizeMemoryItems(parsed.new_action_items),
      updated_objections: normalizeMemoryItems(parsed.updated_objections),
    };
  } catch {
    return null;
  }
}

async function requestMemoryExtraction(
  params: Parameters<typeof collectStructuredAiText>[0]
) {
  return collectStructuredAiText({
    ...params,
    systemPrompt: MEMORY_EXTRACTION_PROMPT,
  });
}

export async function extractMeetingMemory(params: {
  provider: Parameters<typeof collectStructuredAiText>[0]["provider"];
  selectedProvider: Parameters<typeof collectStructuredAiText>[0]["selectedProvider"];
  clientName: string;
  recentTranscript: string;
  existingContext?: ClientGraphContext | null;
  signal?: AbortSignal;
}): Promise<ExtractMemoryResult> {
  if (!params.recentTranscript.trim()) {
    return { extraction: EMPTY_MEMORY_EXTRACTION, parsed: true };
  }

  const memorySummary = params.existingContext
    ? JSON.stringify(
        {
          facts: params.existingContext.facts,
          open_objections: params.existingContext.openObjections,
          open_questions: params.existingContext.openQuestions,
          open_actions: params.existingContext.openActions,
        },
        null,
        2
      )
    : "{}";

  const userMessage = `Client: ${params.clientName}

Current memory:
${memorySummary}

New transcript window:
${params.recentTranscript}`;

  const callParams = {
    provider: params.provider,
    selectedProvider: params.selectedProvider,
    systemPrompt: MEMORY_EXTRACTION_PROMPT,
    userMessage,
    signal: params.signal,
  };

  let result = await requestMemoryExtraction(callParams);

  if (!result.text && !result.aborted && !result.error) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    result = await requestMemoryExtraction({
      ...callParams,
      signal: undefined,
    });
  }

  if (result.aborted) {
    return { extraction: EMPTY_MEMORY_EXTRACTION, parsed: false };
  }

  if (result.error) {
    console.warn("Memory extraction:", result.error);
    return {
      extraction: EMPTY_MEMORY_EXTRACTION,
      parsed: false,
      error: result.error,
    };
  }

  if (!result.text) {
    const hint =
      "AI returned no text. Check Dev Space: valid provider, API key, and model that supports chat completions.";
    console.warn("Memory extraction:", hint);
    return {
      extraction: EMPTY_MEMORY_EXTRACTION,
      parsed: false,
      error: hint,
    };
  }

  const parsed = parseMemoryExtraction(result.text);
  if (!parsed) {
    console.warn(
      "Memory extraction: could not parse model JSON.",
      result.text.slice(0, 200)
    );
    return {
      extraction: EMPTY_MEMORY_EXTRACTION,
      parsed: false,
      error: "Model returned invalid JSON for memory extraction.",
    };
  }

  return { extraction: parsed, parsed: true };
}
