import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage";

export const SYSTEM_DEFAULT_OUTPUT_ID = "default";

export type OutputDeviceOption = {
  id: string;
  name: string;
  is_default: boolean;
};

export async function loadOutputDevices(): Promise<OutputDeviceOption[]> {
  return invoke<OutputDeviceOption[]>("get_output_devices");
}

export function outputIdForCapture(
  selectedId: string | undefined | null
): string | null {
  if (!selectedId || selectedId === SYSTEM_DEFAULT_OUTPUT_ID) {
    return null;
  }
  return selectedId;
}

export function resolveOutputSelection(
  devices: OutputDeviceOption[],
  current: { id: string; name: string }
): { id: string; name: string; changed: boolean } {
  const systemDefault = devices.find((d) => d.is_default) ?? devices[0];

  if (
    !current.id ||
    current.id === SYSTEM_DEFAULT_OUTPUT_ID
  ) {
    return {
      id: SYSTEM_DEFAULT_OUTPUT_ID,
      name: systemDefault
        ? `System default (${systemDefault.name})`
        : "System default",
      changed:
        current.id !== SYSTEM_DEFAULT_OUTPUT_ID ||
        current.name !==
          (systemDefault
            ? `System default (${systemDefault.name})`
            : "System default"),
    };
  }

  const match = devices.find((d) => d.id === current.id);
  if (match) {
    return { id: match.id, name: match.name, changed: false };
  }

  if (!systemDefault) {
    return {
      id: SYSTEM_DEFAULT_OUTPUT_ID,
      name: "System default",
      changed: true,
    };
  }

  return {
    id: SYSTEM_DEFAULT_OUTPUT_ID,
    name: `System default (${systemDefault.name})`,
    changed: true,
  };
}

export function persistOutputSelection(output: { id: string; name: string }) {
  const saved = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AUDIO_DEVICES);
  let devices = {
    input: { id: "", name: "" },
    output,
  };

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      devices = { ...parsed, output };
    } catch {
      // keep defaults
    }
  }

  safeLocalStorage.setItem(
    STORAGE_KEYS.SELECTED_AUDIO_DEVICES,
    JSON.stringify(devices)
  );
}
