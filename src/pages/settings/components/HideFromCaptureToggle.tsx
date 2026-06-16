import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";

interface HideFromCaptureToggleProps {
  className?: string;
}

export const HideFromCaptureToggle = ({
  className,
}: HideFromCaptureToggleProps) => {
  const { customizable, toggleHideFromScreenCapture } = useApp();
  const isHidden = customizable.hideFromScreenCapture?.isEnabled ?? true;

  return (
    <div id="hide-from-capture" className={`space-y-2 ${className}`}>
      <Header
        title="Screen Share & Recording"
        description="Control whether the overlay appears when sharing or recording your screen"
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {isHidden ? "Hide overlay from capture" : "Show overlay in capture"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {isHidden
                ? "The overlay is excluded from screen share and screen recording (default)"
                : "The overlay may be visible to others during screen share or recording"}
            </p>
          </div>
        </div>
        <Switch
          checked={isHidden}
          onCheckedChange={toggleHideFromScreenCapture}
          title={`Toggle to ${isHidden ? "show" : "hide"} overlay in screen capture`}
          aria-label={`Toggle to ${isHidden ? "show" : "hide"} overlay in screen capture`}
        />
      </div>
    </div>
  );
};
