import { Button, Header, Input, Selection, TextInput } from "@/components";
import { ModelSelect } from "@/components/ModelSelect";
import { getDefaultSttModelForProvider, STT_MODEL_CATALOG } from "@/config/stt-models.constants";
import { UseSettingsReturn } from "@/types";
import { KeyIcon, MicIcon, TrashIcon } from "lucide-react";

const STT_PROVIDER_LABELS: Record<string, string> = {
  "openai-whisper": "OpenAI Whisper",
  groq: "Groq Whisper",
  "elevenlabs-stt": "ElevenLabs Scribe",
  "deepgram-stt": "Deepgram",
  "google-stt": "Google Speech-to-Text",
  "azure-stt": "Azure Speech",
  "speechmatics-stt": "Speechmatics",
  "rev-ai-stt": "Rev.ai",
  "ibm-watson-stt": "IBM Watson",
};

const EXTRA_STT_FIELDS: Record<
  string,
  { key: string; label: string; placeholder: string }[]
> = {
  "google-stt": [
    {
      key: "project_id",
      label: "Google Cloud project ID",
      placeholder: "my-gcp-project",
    },
  ],
  "azure-stt": [
    {
      key: "region",
      label: "Azure region",
      placeholder: "eastus",
    },
  ],
  "rev-ai-stt": [
    {
      key: "options",
      label: "Rev.ai options (JSON)",
      placeholder: '{"skip_diarization": false}',
    },
  ],
};

function formatSttProviderLabel(id: string): string {
  return STT_PROVIDER_LABELS[id] ?? id;
}

function builtInSttProviderOptions(
  allSttProviders: UseSettingsReturn["allSttProviders"]
) {
  return allSttProviders
    .filter((provider) => !provider.isCustom && provider.id?.trim())
    .map((provider) => ({
      label: formatSttProviderLabel(provider.id!.trim()),
      value: provider.id!.trim(),
    }));
}

function ApiKeyField({
  providerId,
  value,
  onChange,
}: {
  providerId: string;
  value: string;
  onChange: (apiKey: string) => void;
}) {
  if (!providerId) return null;

  return (
    <div className="space-y-1">
      <Header
        title="API key"
        description={`${formatSttProviderLabel(providerId)} key — stored locally only.`}
      />
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="**********"
          value={value}
          onChange={(next) =>
            onChange(typeof next === "string" ? next : next.target.value)
          }
          className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
        />
        {value.trim() ? (
          <Button
            onClick={() => onChange("")}
            size="icon"
            variant="destructive"
            className="shrink-0 h-11 w-11"
            title="Remove API key"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            disabled
            size="icon"
            className="shrink-0 h-11 w-11"
            title="Enter API key"
          >
            <KeyIcon className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SttModelSettings({
  allSttProviders,
  selectedSttProvider,
  onSetSelectedSttProvider,
}: Pick<
  UseSettingsReturn,
  "allSttProviders" | "selectedSttProvider" | "onSetSelectedSttProvider"
>) {
  const providerOptions = builtInSttProviderOptions(allSttProviders);
  const providerId = selectedSttProvider.provider;
  const apiKey = selectedSttProvider.variables.api_key ?? "";
  const model = selectedSttProvider.variables.model ?? "";
  const extraFields = providerId ? EXTRA_STT_FIELDS[providerId] ?? [] : [];

  const handleProviderChange = (nextProviderId: string) => {
    const variables: Record<string, string> = {};
    const defaultModel = getDefaultSttModelForProvider(nextProviderId);
    if (defaultModel) {
      variables.model = defaultModel;
    }
    onSetSelectedSttProvider({
      provider: nextProviderId,
      variables,
    });
  };

  const setVariable = (key: string, value: string) => {
    onSetSelectedSttProvider({
      ...selectedSttProvider,
      variables: {
        ...selectedSttProvider.variables,
        [key]: value,
      },
    });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <MicIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Speech-to-text</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Transcribes meeting audio into live captions and coach context.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Header title="Provider" description="STT vendor for live capture." />
          <Selection
            selected={providerId}
            placeholder="Choose STT provider"
            options={providerOptions}
            onChange={handleProviderChange}
          />
        </div>

        <ApiKeyField
          providerId={providerId}
          value={apiKey}
          onChange={(key) => setVariable("api_key", key)}
        />

        {STT_MODEL_CATALOG.hasCuratedModelList(providerId) ? (
          <ModelSelect
            providerId={providerId}
            model={model}
            catalog={STT_MODEL_CATALOG}
            onModelChange={(value) => setVariable("model", value)}
          />
        ) : null}

        {extraFields.map((field) => (
          <div className="space-y-1" key={field.key}>
            <Header
              title={field.label}
              description={`Required for ${formatSttProviderLabel(providerId)}.`}
            />
            <TextInput
              placeholder={field.placeholder}
              value={selectedSttProvider.variables[field.key] ?? ""}
              onChange={(value) => setVariable(field.key, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
