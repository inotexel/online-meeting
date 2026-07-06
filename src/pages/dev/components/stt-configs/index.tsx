import { Header } from "@/components";
import { UseSettingsReturn } from "@/types";
import { SttModelSettings } from "./SttModelSettings";

export const STTProviders = (settings: UseSettingsReturn) => {
  return (
    <div id="stt-providers" className="space-y-3">
      <Header
        title="Speech-to-text"
        description="Provider, API key, and model for live call transcription."
        isMainTitle
      />
      <SttModelSettings
        allSttProviders={settings.allSttProviders}
        selectedSttProvider={settings.selectedSttProvider}
        onSetSelectedSttProvider={settings.onSetSelectedSttProvider}
      />
    </div>
  );
};
