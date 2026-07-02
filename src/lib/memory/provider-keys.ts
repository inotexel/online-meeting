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
