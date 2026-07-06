import { Header, Selection, TextInput } from "@/components";
import { ModelCatalog } from "@/config/model-catalog.types";
import { LLM_MODEL_CATALOG } from "@/config/llm-models.constants";

interface ModelSelectProps {
  providerId: string;
  model: string;
  onModelChange: (model: string) => void;
  title?: string;
  description?: string;
  disabled?: boolean;
  catalog?: ModelCatalog;
}

export function ModelSelect({
  providerId,
  model,
  onModelChange,
  title = "Model",
  description,
  disabled = false,
  catalog = LLM_MODEL_CATALOG,
}: ModelSelectProps) {
  const curated = catalog.hasCuratedModelList(providerId);
  const models = catalog.getModelsForProvider(providerId);

  if (!providerId) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose a provider first to pick a model.
      </p>
    );
  }

  if (!curated) {
    return (
      <div className="space-y-1">
        <Header
          title={title}
          description={
            description ??
            "Custom or local providers — enter the exact model ID your endpoint expects."
          }
        />
        <TextInput
          placeholder="e.g. llama3.2, my-fine-tuned-model"
          value={model}
          onChange={onModelChange}
        />
      </div>
    );
  }

  const selectedModel =
    model && models.some((m) => m.id === model)
      ? model
      : model || catalog.getDefaultModelForProvider(providerId);

  return (
    <div className="space-y-1">
      <Header
        title={title}
        description={
          description ??
          "Exact API model ID — sent verbatim in the request."
        }
      />
      <Selection
        selected={selectedModel}
        disabled={disabled}
        placeholder="Choose model"
        options={models.map((m) => ({
          label: m.description ? `${m.label} — ${m.description}` : m.label,
          value: m.id,
        }))}
        onChange={(value) => onModelChange(value)}
      />
      {model && !models.some((m) => m.id === model) && (
        <p className="text-[11px] text-amber-700">
          Saved model &quot;{model}&quot; is not in the curated list — pick a
          dropdown option to update.
        </p>
      )}
    </div>
  );
}
