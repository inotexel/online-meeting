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
