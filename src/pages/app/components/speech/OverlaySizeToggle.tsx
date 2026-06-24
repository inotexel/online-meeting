import { Button } from "@/components";
import type { OverlaySizeMode } from "@/lib/overlay-size";
import { cn } from "@/lib/utils";
import { ExpandIcon, Maximize2Icon, RectangleHorizontalIcon } from "lucide-react";

const MODES: {
  id: OverlaySizeMode;
  label: string;
  title: string;
  icon: typeof Maximize2Icon;
}[] = [
  {
    id: "fit",
    label: "Fit",
    title: "Fit to screen (recommended)",
    icon: Maximize2Icon,
  },
  {
    id: "original",
    label: "Original",
    title: "Original compact panel size",
    icon: RectangleHorizontalIcon,
  },
  {
    id: "fullscreen",
    label: "Full",
    title: "Full screen overlay",
    icon: ExpandIcon,
  },
];

type OverlaySizeToggleProps = {
  value: OverlaySizeMode;
  onChange: (mode: OverlaySizeMode) => void;
  disabled?: boolean;
};

export const OverlaySizeToggle = ({
  value,
  onChange,
  disabled = false,
}: OverlaySizeToggleProps) => {
  return (
    <div
      className="flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5"
      role="group"
      aria-label="Overlay size"
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.id;

        return (
          <Button
            key={mode.id}
            type="button"
            size="sm"
            variant={isActive ? "default" : "ghost"}
            disabled={disabled}
            title={mode.title}
            className={cn(
              "h-6 px-2 text-[10px] gap-1 rounded-sm",
              !isActive && "text-muted-foreground"
            )}
            onClick={() => onChange(mode.id)}
            aria-pressed={isActive}
          >
            <Icon className="w-3 h-3" />
            {mode.label}
          </Button>
        );
      })}
    </div>
  );
};
