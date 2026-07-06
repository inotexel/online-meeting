import { cn } from "@/lib/utils";
import { AudioWaveformIcon, RadioIcon } from "lucide-react";
import { CaptureMode } from "@/hooks/useSystemAudio";

/** Re-enable when realtime capture should appear in the mode switcher. */
const SHOW_REALTIME_MODE = false;

interface ModeSwitcherProps {
  captureMode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  disabled?: boolean;
}

const MODES: {
  id: CaptureMode;
  icon: typeof AudioWaveformIcon;
  label: string;
  description: string;
}[] = [
  {
    id: "vad",
    icon: AudioWaveformIcon,
    label: "Auto-detect",
    description: "Chunk on silence",
  },
  {
    id: "realtime",
    icon: RadioIcon,
    label: "Realtime",
    description: "Live transcript",
  },
];

export const ModeSwitcher = ({
  captureMode,
  onModeChange,
  disabled = false,
}: ModeSwitcherProps) => {
  const visibleModes = SHOW_REALTIME_MODE
    ? MODES
    : MODES.filter((mode) => mode.id !== "realtime");

  const activeMode =
    captureMode === "continuous" || captureMode === "realtime"
      ? "vad"
      : captureMode;

  return (
    <div
      className={cn(
        "flex bg-muted rounded-lg w-full p-0.5 gap-0.5",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {visibleModes.map(({ id, icon: Icon, label, description }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          disabled={disabled}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-1.5 py-1.5 rounded-md transition-all min-w-0",
            activeMode === id
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          <div className="flex flex-col items-start min-w-0">
            <span className="text-[10px] font-medium leading-tight truncate w-full">
              {label}
            </span>
            <span className="text-[8px] font-normal opacity-60 leading-tight truncate w-full">
              {description}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};