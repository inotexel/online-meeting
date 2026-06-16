import { cn } from "@/lib/utils";
import { AudioWaveformIcon, MicIcon, RadioIcon } from "lucide-react";
import { CaptureMode } from "@/hooks/useSystemAudio";

interface ModeSwitcherProps {
  captureMode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  disabled?: boolean;
}

export const ModeSwitcher = ({
  captureMode,
  onModeChange,
  disabled = false,
}: ModeSwitcherProps) => {
  const modes: {
    id: CaptureMode;
    icon: typeof AudioWaveformIcon;
    label: string;
    description: string;
  }[] = [
    {
      id: "vad",
      icon: AudioWaveformIcon,
      label: "Auto-detect",
      description: "(voice activity)",
    },
    {
      id: "continuous",
      icon: MicIcon,
      label: "Manual",
      description: "(press to record)",
    },
    {
      id: "realtime",
      icon: RadioIcon,
      label: "Realtime",
      description: "(live transcript)",
    },
  ];

  return (
    <div
      className={cn(
        "flex bg-muted rounded-lg w-full p-0.5 gap-0.5",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {modes.map(({ id, icon: Icon, label, description }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          disabled={disabled}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-1.5 py-1.5 rounded-md transition-all min-w-0",
            captureMode === id
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
