import { Button } from "@/components";
import type { OverlaySizeMode } from "@/lib/overlay-size";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ExpandIcon,
  RectangleHorizontalIcon,
} from "lucide-react";

const MODES: {
  id: OverlaySizeMode;
  label: string;
  title: string;
  icon: typeof ExpandIcon;
}[] = [
  {
    id: "original",
    label: "Original",
    title: "Compact panel size",
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
  const active = MODES.find((mode) => mode.id === value) ?? MODES[0];
  const ActiveIcon = active.icon;
  const otherModes = MODES.filter((mode) => mode.id !== value);

  return (
    <div className="relative group" aria-label="Overlay size">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        title={active.title}
        className="h-6 gap-1 rounded-md px-2 text-[10px]"
      >
        <ActiveIcon className="h-3 w-3" />
        {active.label}
        <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
      </Button>

      {!disabled && otherModes.length > 0 && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 pt-1",
            "pointer-events-none opacity-0 translate-y-0.5",
            "transition-all duration-150",
            "group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0",
            "group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0"
          )}
        >
          <div className="min-w-[9rem] overflow-hidden rounded-md border border-border/60 bg-popover p-1 shadow-md">
            {otherModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  title={mode.title}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                    "text-foreground hover:bg-muted transition-colors"
                  )}
                  onClick={() => onChange(mode.id)}
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
