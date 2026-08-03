import { Button, Header, Input, Selection } from "@/components";
import { ModelSelect } from "@/components/ModelSelect";
import { getDefaultModelForProvider } from "@/config/llm-models.constants";
import { useCoachAiSettings } from "@/hooks/useCoachAiSettings";
import { UseSettingsReturn } from "@/types";
import { BotIcon, KeyIcon, LightbulbIcon, TrashIcon } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  claude: "Anthropic Claude",
  grok: "xAI Grok",
  gemini: "Google Gemini",
  mistral: "Mistral",
  cohere: "Cohere",
  groq: "Groq",
  perplexity: "Perplexity",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

function formatProviderLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

function builtInProviderOptions(
  allAiProviders: UseSettingsReturn["allAiProviders"]
) {
  return allAiProviders
    .filter((provider) => !provider.isCustom && provider.id?.trim())
    .map((provider) => ({
      label: formatProviderLabel(provider.id!.trim()),
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
        description={`${formatProviderLabel(providerId)} key — stored locally only.`}
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

function AiRoleCard({
  title,
  description,
  icon: Icon,
  providerId,
  model,
  apiKey,
  providerOptions,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
}: {
  title: string;
  description: string;
  icon: typeof BotIcon;
  providerId: string;
  model: string;
  apiKey: string;
  providerOptions: { label: string; value: string }[];
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Header title="Provider" description="LLM vendor for this feature." />
          <Selection
            selected={providerId}
            placeholder="Choose provider"
            options={providerOptions}
            onChange={onProviderChange}
          />
        </div>

        <ApiKeyField
          providerId={providerId}
          value={apiKey}
          onChange={onApiKeyChange}
        />

        <ModelSelect
          providerId={providerId}
          model={model}
          onModelChange={onModelChange}
        />
      </div>
    </div>
  );
}

export function AiModelSettings({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
}: Pick<
  UseSettingsReturn,
  "allAiProviders" | "selectedAIProvider" | "onSetSelectedAIProvider"
>) {
  const { settings, updateRole } = useCoachAiSettings();
  const providerOptions = builtInProviderOptions(allAiProviders);

  const chatApiKey = selectedAIProvider.variables.api_key ?? "";

  const handleChatProviderChange = (providerId: string) => {
    onSetSelectedAIProvider({
      provider: providerId,
      variables: {
        model: getDefaultModelForProvider(providerId),
      },
    });
  };

  const handleWhisperProviderChange = (providerId: string) => {
    updateRole("whisper", {
      providerId,
      model: getDefaultModelForProvider(providerId),
      apiKey: "",
    });
  };

  return (
    <div className="space-y-4">
      <AiRoleCard
        title="Chat AI"
        description="General chat, ask me anything on calls, and memory tasks."
        icon={BotIcon}
        providerId={selectedAIProvider.provider}
        model={selectedAIProvider.variables.model ?? ""}
        apiKey={chatApiKey}
        providerOptions={providerOptions}
        onProviderChange={handleChatProviderChange}
        onModelChange={(model) =>
          onSetSelectedAIProvider({
            ...selectedAIProvider,
            variables: { ...selectedAIProvider.variables, model },
          })
        }
        onApiKeyChange={(apiKey) =>
          onSetSelectedAIProvider({
            ...selectedAIProvider,
            variables: { ...selectedAIProvider.variables, api_key: apiKey },
          })
        }
      />

      <AiRoleCard
        title="Whisper brain"
        description="Live closing coach — cheat-sheet whispers during calls."
        icon={LightbulbIcon}
        providerId={settings.whisper.providerId}
        model={settings.whisper.model}
        apiKey={settings.whisper.apiKey ?? ""}
        providerOptions={providerOptions}
        onProviderChange={handleWhisperProviderChange}
        onModelChange={(model) => updateRole("whisper", { model })}
        onApiKeyChange={(apiKey) => updateRole("whisper", { apiKey })}
      />
    </div>
  );
}
