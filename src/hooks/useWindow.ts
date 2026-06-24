import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useState } from "react";
import {
  type OverlaySizeMode,
  type ResizeWindowOptions,
  DEFAULT_OVERLAY_SIZE_MODE,
  loadOverlaySizeMode,
  resolveResizeOptions,
  saveOverlaySizeMode,
} from "@/lib/overlay-size";

// Helper function to check if any popover is open in the DOM
const isAnyPopoverOpen = (): boolean => {
  if (document.body.dataset.pluelyCapturing === "true") {
    return true;
  }
  if (
    document.querySelector('[data-slot="popover-content"][data-state="open"]')
  ) {
    return true;
  }
  const popoverContents = document.querySelectorAll(
    "[data-radix-popper-content-wrapper]"
  );
  return popoverContents.length > 0;
};

const toLayoutMode = (
  expanded: boolean,
  sizeMode: OverlaySizeMode
): "compact" | "fit" | "original" | "fullscreen" => {
  if (!expanded) {
    return "compact";
  }
  return sizeMode;
};

export const useWindowResize = () => {
  const [overlaySizeMode, setOverlaySizeModeState] = useState<OverlaySizeMode>(
    () => loadOverlaySizeMode()
  );

  const setOverlaySizeMode = useCallback((mode: OverlaySizeMode) => {
    setOverlaySizeModeState(mode);
    saveOverlaySizeMode(mode);
  }, []);

  const resizeWindow = useCallback(
    async (expanded: boolean, heightOrOptions?: number | ResizeWindowOptions) => {
      try {
        if (!expanded && isAnyPopoverOpen()) {
          return;
        }

        const options = resolveResizeOptions(heightOrOptions);
        const sizeMode = options.sizeMode ?? overlaySizeMode;
        const mode = toLayoutMode(expanded, sizeMode);

        await invoke("set_overlay_layout", {
          mode,
          height: options.originalHeight,
        });
      } catch (error) {
        console.error("Failed to resize window:", error);
      }
    },
    [overlaySizeMode]
  );

  const applyOverlaySizeMode = useCallback(
    async (mode: OverlaySizeMode, originalHeight?: number) => {
      setOverlaySizeMode(mode);
      await resizeWindow(true, { sizeMode: mode, originalHeight });
    },
    [resizeWindow, setOverlaySizeMode]
  );

  // Setup drag handling and popover monitoring
  useEffect(() => {
    let isDragging = false;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isDragRegion = target.closest('[data-tauri-drag-region="true"]');

      if (isDragRegion) {
        isDragging = true;
      }
    };

    const handleMouseUp = async () => {
      if (isDragging) {
        isDragging = false;

        setTimeout(() => {
          if (!isAnyPopoverOpen()) {
            resizeWindow(false);
          }
        }, 100);
      }
    };

    const observer = new MutationObserver(() => {
      if (!isAnyPopoverOpen()) {
        resizeWindow(false);
      }
    });

    // Observe the body for changes to detect popover open/close
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [resizeWindow]);

  return {
    resizeWindow,
    overlaySizeMode,
    setOverlaySizeMode,
    applyOverlaySizeMode,
    defaultOverlaySizeMode: DEFAULT_OVERLAY_SIZE_MODE,
  };
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
