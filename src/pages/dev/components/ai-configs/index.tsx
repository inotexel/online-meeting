import { Header } from "@/components";
import { UseSettingsReturn } from "@/types";
import { AiModelSettings } from "./AiModelSettings";

export const AIProviders = (settings: UseSettingsReturn) => {
  return (
    <div id="ai-providers" className="space-y-3">
      <Header
        title="AI Models"
        description="Choose provider, API key, and model for chat and live coaching."
        isMainTitle
      />
      <AiModelSettings
        allAiProviders={settings.allAiProviders}
        selectedAIProvider={settings.selectedAIProvider}
        onSetSelectedAIProvider={settings.onSetSelectedAIProvider}
      />
    </div>
  );
};
