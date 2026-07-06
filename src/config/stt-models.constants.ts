import { ModelCatalog, ModelOption } from "./model-catalog.types";

/** Exact transcription model IDs per built-in STT provider. */
export const STT_MODELS_BY_PROVIDER: Record<string, ModelOption[]> = {
  "openai-whisper": [
    {
      id: "gpt-4o-mini-transcribe",
      label: "GPT-4o Mini Transcribe",
      description: "Recommended — best quality/cost",
    },
    { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
    {
      id: "gpt-4o-transcribe-diarize",
      label: "GPT-4o Transcribe Diarize",
      description: "Speaker labels",
    },
    { id: "whisper-1", label: "Whisper v1", description: "Legacy" },
  ],
  groq: [
    {
      id: "whisper-large-v3",
      label: "Whisper Large v3",
      description: "Highest accuracy",
    },
    {
      id: "whisper-large-v3-turbo",
      label: "Whisper Large v3 Turbo",
      description: "Faster",
    },
  ],
  "elevenlabs-stt": [
    { id: "scribe_v2", label: "Scribe v2", description: "Latest batch STT" },
    { id: "scribe_v1", label: "Scribe v1", description: "General purpose" },
  ],
  "deepgram-stt": [
    { id: "nova-3", label: "Nova-3", description: "Latest general" },
    { id: "nova-3-general", label: "Nova-3 General" },
    { id: "nova-3-medical", label: "Nova-3 Medical" },
    { id: "nova-2", label: "Nova-2" },
    { id: "nova-2-general", label: "Nova-2 General" },
    { id: "enhanced", label: "Enhanced" },
    { id: "base", label: "Base" },
  ],
};

export function getSttModelsForProvider(providerId: string): ModelOption[] {
  return STT_MODELS_BY_PROVIDER[providerId] ?? [];
}

export function hasSttCuratedModelList(providerId: string): boolean {
  return providerId in STT_MODELS_BY_PROVIDER;
}

export function getDefaultSttModelForProvider(providerId: string): string {
  const models = getSttModelsForProvider(providerId);
  return models[0]?.id ?? "";
}

export const STT_MODEL_CATALOG: ModelCatalog = {
  getModelsForProvider: getSttModelsForProvider,
  getDefaultModelForProvider: getDefaultSttModelForProvider,
  hasCuratedModelList: hasSttCuratedModelList,
};
