/**
 * Exact API model IDs for built-in BYOK providers.
 * IDs match vendor docs — use these strings verbatim in API requests.
 * @see https://platform.openai.com/docs/models
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */

import { ModelCatalog } from "./model-catalog.types";

export interface LlmModelOption {
  /** Exact model string sent to the API as `model` */
  id: string;
  label: string;
  description?: string;
}

/** Built-in provider id → curated production chat models */
export const LLM_MODELS_BY_PROVIDER: Record<string, LlmModelOption[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o", description: "Fast, capable multimodal" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", description: "Lower cost, fast" },
    { id: "gpt-4.1", label: "GPT-4.1", description: "Strong coding & instruction" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-5-nano", label: "GPT-5 nano" },
    { id: "o3-mini", label: "o3-mini", description: "Reasoning, lower cost" },
    { id: "o1", label: "o1", description: "Reasoning" },
  ],
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Balanced" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Most capable" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-fable-5", label: "Claude Fable 5", description: "Long-running agents" },
  ],
  grok: [
    { id: "grok-4.3", label: "Grok 4.3", description: "Current flagship" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3-mini-fast", label: "Grok 3 Mini Fast" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Best reasoning" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Fast, balanced" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", description: "Lowest cost" },
    { id: "gemini-2.0-flash-001", label: "Gemini 2.0 Flash 001" },
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large (latest)" },
    { id: "mistral-small-latest", label: "Mistral Small (latest)" },
    { id: "codestral-latest", label: "Codestral (latest)" },
    { id: "open-mistral-nemo", label: "Open Mistral Nemo" },
  ],
  cohere: [
    { id: "command-a-03-2025", label: "Command A (03-2025)" },
    { id: "command-r-plus-08-2024", label: "Command R+ (08-2024)" },
    { id: "command-r-08-2024", label: "Command R (08-2024)" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
    { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  ],
  perplexity: [
    { id: "sonar", label: "Sonar" },
    { id: "sonar-pro", label: "Sonar Pro" },
    { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
  ],
  openrouter: [
    { id: "openai/gpt-4o", label: "OpenAI GPT-4o (via OpenRouter)" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash (via OpenRouter)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
    { id: "x-ai/grok-3-beta", label: "Grok 3 Beta (via OpenRouter)" },
  ],
};

export function getModelsForProvider(providerId: string): LlmModelOption[] {
  return LLM_MODELS_BY_PROVIDER[providerId] ?? [];
}

export function hasCuratedModelList(providerId: string): boolean {
  return providerId in LLM_MODELS_BY_PROVIDER;
}

export function getDefaultModelForProvider(providerId: string): string {
  const models = getModelsForProvider(providerId);
  return models[0]?.id ?? "";
}

export function isKnownModelForProvider(
  providerId: string,
  modelId: string
): boolean {
  if (!modelId.trim()) return false;
  const models = getModelsForProvider(providerId);
  if (!models.length) return true;
  return models.some((m) => m.id === modelId);
}

export const LLM_MODEL_CATALOG: ModelCatalog = {
  getModelsForProvider,
  getDefaultModelForProvider,
  hasCuratedModelList,
};
