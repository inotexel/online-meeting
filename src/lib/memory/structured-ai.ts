import { fetchAIResponse } from "@/lib/functions";
import { TYPE_PROVIDER } from "@/types";
import { Message } from "@/types/completion";

export type StructuredAiResult = {
  text: string;
  aborted: boolean;
  error?: string;
};

/** Collect a full model response for JSON-only tasks (no markdown/length UI prompt injection). */
export async function collectStructuredAiText(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
}): Promise<StructuredAiResult> {
  if (params.signal?.aborted) {
    return { text: "", aborted: true };
  }

  let full = "";
  try {
    for await (const chunk of fetchAIResponse({
      provider: params.provider,
      selectedProvider: params.selectedProvider,
      systemPrompt: params.systemPrompt,
      userMessage: params.userMessage,
      history: [] as Message[],
      imagesBase64: [],
      signal: params.signal,
      enhanceSystemPrompt: false,
    })) {
      full += chunk;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { text: "", aborted: true };
    }
    return {
      text: "",
      aborted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const text = full.trim();
  if (
    text.startsWith("API request failed:") ||
    text.startsWith("Network error during API request:") ||
    text.startsWith("Pluely API Error:") ||
    text.startsWith("Error in fetchAIResponse:") ||
    text.startsWith("Error reading stream:") ||
    text.startsWith("Failed to parse non-streaming response:")
  ) {
    return { text: "", aborted: false, error: text };
  }

  return { text, aborted: false };
}
