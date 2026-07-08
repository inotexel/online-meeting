import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";

/** Extract API key from a provider's variable map (STT, AI, etc.). */
export function getProviderApiKey(
  variables: Record<string, string>
): string {
  for (const [key, value] of Object.entries(variables)) {
    if (
      key.toUpperCase().includes("API_KEY") ||
      key.toLowerCase() === "api_key"
    ) {
      return value?.trim() ?? "";
    }
  }
  return "";
}

/** OpenAI key for embeddings — try STT provider first, then AI provider. */
export function resolveOpenAiEmbeddingKey(
  sttVariables: Record<string, string>,
  aiVariables: Record<string, string>
): string {
  return (
    getProviderApiKey(sttVariables) || getProviderApiKey(aiVariables)
  );
}

/** Fresh STT key for live capture — reads storage so early system-audio events don't use a stale closure. */
export function resolveTranscriptionApiKey(
  sttVariables?: Record<string, string>,
  options?: {
    whisperApiKey?: string;
    aiVariables?: Record<string, string>;
  }
): string {
  const fromArgs = sttVariables ? getProviderApiKey(sttVariables) : "";
  if (fromArgs) return fromArgs;

  const whisperKey = options?.whisperApiKey?.trim() ?? "";
  if (whisperKey) return whisperKey;

  const fromAi = options?.aiVariables
    ? getProviderApiKey(options.aiVariables)
    : "";
  if (fromAi) return fromAi;

  try {
    const savedStt = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_STT_PROVIDER);
    if (savedStt) {
      const parsed = JSON.parse(savedStt) as {
        variables?: Record<string, string>;
      };
      const fromStorage = getProviderApiKey(parsed.variables ?? {});
      if (fromStorage) return fromStorage;
    }
    const savedCoach = safeLocalStorage.getItem(STORAGE_KEYS.COACH_AI_SETTINGS);
    if (savedCoach) {
      const parsed = JSON.parse(savedCoach) as {
        whisper?: { apiKey?: string };
      };
      const coachKey = parsed.whisper?.apiKey?.trim() ?? "";
      if (coachKey) return coachKey;
    }
  } catch {
    // ignore parse/storage errors
  }

  return "";
}

/** Chat / memory LLM config — use Chat AI key, else Whisper (same provider) or STT key. */
export function buildChatAiSelectedProvider(
  selectedAIProvider: { provider: string; variables: Record<string, string> },
  options?: {
    whisperProviderId?: string;
    whisperApiKey?: string;
    sttVariables?: Record<string, string>;
  }
): { provider: string; variables: Record<string, string> } {
  const variables = { ...selectedAIProvider.variables };
  if (getProviderApiKey(variables)) {
    return { provider: selectedAIProvider.provider, variables };
  }

  const whisperKey = options?.whisperApiKey?.trim() ?? "";
  if (whisperKey && options?.whisperProviderId === selectedAIProvider.provider) {
    variables.api_key = whisperKey;
    return { provider: selectedAIProvider.provider, variables };
  }

  const sttKey = options?.sttVariables
    ? getProviderApiKey(options.sttVariables)
    : "";
  if (sttKey) {
    variables.api_key = sttKey;
  }

  return { provider: selectedAIProvider.provider, variables };
}
