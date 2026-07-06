import { useCallback, useEffect, useState } from "react";
import {
  CoachAiRoleConfig,
  CoachAiSettings,
  COACH_AI_SETTINGS_CHANGED_EVENT,
  DEFAULT_COACH_AI_SETTINGS,
  loadCoachAiSettings,
  saveCoachAiSettings,
} from "@/lib/storage/coach-ai-config";

export function useCoachAiSettings() {
  const [settings, setSettings] = useState<CoachAiSettings>(() =>
    loadCoachAiSettings()
  );

  useEffect(() => {
    const sync = () => setSettings(loadCoachAiSettings());
    window.addEventListener(COACH_AI_SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COACH_AI_SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const updateRole = useCallback(
    (role: keyof CoachAiSettings, patch: Partial<CoachAiRoleConfig>) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          [role]: { ...prev[role], ...patch },
        };
        saveCoachAiSettings(next);
        return next;
      });
    },
    []
  );

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_COACH_AI_SETTINGS };
    setSettings(next);
    saveCoachAiSettings(next);
  }, []);

  return { settings, updateRole, resetSettings };
}
