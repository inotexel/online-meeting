export type OverlaySizeMode = "original" | "fullscreen";

export const OVERLAY_SIZE_STORAGE_KEY = "pluely-overlay-size-mode";

export const DEFAULT_OVERLAY_SIZE_MODE: OverlaySizeMode = "original";

export function loadOverlaySizeMode(): OverlaySizeMode {
  try {
    const stored = localStorage.getItem(OVERLAY_SIZE_STORAGE_KEY);
    if (stored === "original" || stored === "fullscreen") {
      return stored;
    }
    // Migrate removed "fit" mode to fullscreen
    if (stored === "fit") {
      return "fullscreen";
    }
  } catch {
    // ignore
  }
  return DEFAULT_OVERLAY_SIZE_MODE;
}

export function saveOverlaySizeMode(mode: OverlaySizeMode): void {
  try {
    localStorage.setItem(OVERLAY_SIZE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export type ResizeWindowOptions = {
  originalHeight?: number;
  sizeMode?: OverlaySizeMode;
};

export function resolveResizeOptions(
  heightOrOptions?: number | ResizeWindowOptions
): ResizeWindowOptions {
  if (typeof heightOrOptions === "number") {
    return { originalHeight: heightOrOptions };
  }
  return heightOrOptions ?? {};
}
