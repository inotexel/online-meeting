import { STORAGE_KEYS } from "@/config";
import { getDefaultModelForProvider } from "@/config/llm-models.constants";
import { safeLocalStorage } from "@/lib";
import { TYPE_PROVIDER } from "@/types";

export const COACH_AI_SETTINGS_CHANGED_EVENT = "coach-ai-settings-changed";

export interface CoachAiRoleConfig {
  providerId: string;
  model: string;
  apiKey?: string;
}

export interface CoachAiSettings {
  whisper: CoachAiRoleConfig;
  ask: CoachAiRoleConfig;
}

export const EMPTY_COACH_AI_ROLE: CoachAiRoleConfig = {
  providerId: "",
  model: "",
};

export const DEFAULT_COACH_AI_SETTINGS: CoachAiSettings = {
  whisper: { ...EMPTY_COACH_AI_ROLE },
  ask: { ...EMPTY_COACH_AI_ROLE },
};

function parseRoleConfig(raw: unknown): CoachAiRoleConfig {
  if (!raw || typeof raw !== "object") return { ...EMPTY_COACH_AI_ROLE };
  const obj = raw as Record<string, unknown>;
  return {
    providerId: String(obj.providerId ?? "").trim(),
    model: String(obj.model ?? "").trim(),
    apiKey: String(obj.apiKey ?? "").trim() || undefined,
  };
}

export function loadCoachAiSettings(): CoachAiSettings {
  try {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.COACH_AI_SETTINGS);
    if (!stored) return { ...DEFAULT_COACH_AI_SETTINGS };
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      whisper: parseRoleConfig(parsed.whisper),
      ask: parseRoleConfig(parsed.ask),
    };
  } catch {
    return { ...DEFAULT_COACH_AI_SETTINGS };
  }
}

export function saveCoachAiSettings(settings: CoachAiSettings): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.COACH_AI_SETTINGS,
    JSON.stringify(settings)
  );
  window.dispatchEvent(
    new CustomEvent(COACH_AI_SETTINGS_CHANGED_EVENT, { detail: settings })
  );
}

export function resolveCoachRoleConfig(
  role: CoachAiRoleConfig,
  fallback: { provider: string; variables: Record<string, string> }
): CoachAiRoleConfig {
  const providerId = role.providerId || fallback.provider;
  const model =
    role.model ||
    fallback.variables.model ||
    getDefaultModelForProvider(providerId);
  return { providerId, model };
}

export function buildCoachSelectedProvider(
  role: CoachAiRoleConfig,
  allProviders: TYPE_PROVIDER[],
  fallback: { provider: string; variables: Record<string, string> }
): {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
} {
  const resolved = resolveCoachRoleConfig(role, fallback);
  const provider = allProviders.find((p) => p.id === resolved.providerId);

  const variables: Record<string, string> = {};

  const roleApiKey = role.apiKey?.trim();
  if (roleApiKey) {
    variables.api_key = roleApiKey;
  } else if (fallback.provider === resolved.providerId) {
    Object.assign(variables, fallback.variables);
  }

  if (resolved.model) {
    variables.model = resolved.model;
  }

  return {
    provider,
    selectedProvider: {
      provider: resolved.providerId,
      variables,
    },
  };
}
