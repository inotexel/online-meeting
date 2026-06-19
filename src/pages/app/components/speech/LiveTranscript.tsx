import { useEffect, useLayoutEffect, useRef } from "react";
import { ScrollArea, Switch } from "@/components";
import { RadioIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LiveTranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  speakerLabel?: string | null;
}

interface LiveTranscriptProps {
  segments: LiveTranscriptSegment[];
  pendingDelta: string;
  pendingSpeakerLabel?: string | null;
  isSessionActive: boolean;
  isCapturing?: boolean;
  showSpeakerLabels?: boolean;
  speakerLabelsEnabled?: boolean;
  onSpeakerLabelsChange?: (enabled: boolean) => void;
  speakerToggleDisabled?: boolean;
  readOnly?: boolean;
  title?: string;
  emptyMessage?: string;
  maxHeightClass?: string;
}

export function formatSpeakerLabel(label?: string | null): string | null {
  if (!label || label === "UNKNOWN") return null;
  const letter = label.trim().toUpperCase();
  if (letter.length === 1 && letter >= "A" && letter <= "Z") {
    return `Speaker ${letter.charCodeAt(0) - 64}`;
  }
  return `Speaker ${label}`;
}

export const LiveTranscript = ({
  segments,
  pendingDelta,
  pendingSpeakerLabel,
  isSessionActive,
  isCapturing = false,
  showSpeakerLabels = false,
  speakerLabelsEnabled = false,
  onSpeakerLabelsChange,
  speakerToggleDisabled = false,
  readOnly = false,
  title = "Live Transcript",
  emptyMessage,
  maxHeightClass = "max-h-64",
}: LiveTranscriptProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastSegmentText = segments[segments.length - 1]?.text ?? "";
  const showPending =
    pendingDelta.trim().length > 0 && pendingDelta.trim() !== lastSegmentText;
  const hasContent = segments.length > 0 || showPending;

  useLayoutEffect(() => {
    if (readOnly) return;

    const viewport = bottomRef.current?.closest(
      "[data-slot='scroll-area-viewport']"
    ) as HTMLElement | null;

    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [segments, pendingDelta, showPending, pendingSpeakerLabel, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [segments, showPending, pendingSpeakerLabel, readOnly]);

  const renderLine = (
    text: string,
    speakerLabel?: string | null,
    italic = false
  ) => {
    const speaker = showSpeakerLabels
      ? formatSpeakerLabel(speakerLabel)
      : null;

    return (
      <p
        className={cn(
          "text-xs leading-relaxed",
          italic ? "text-muted-foreground italic" : "text-foreground"
        )}
      >
        {speaker && (
          <span className="font-semibold text-primary not-italic mr-1.5">
            {speaker}:
          </span>
        )}
        {text}
      </p>
    );
  };

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RadioIcon
            className={cn(
              "w-3.5 h-3.5 flex-shrink-0",
              isSessionActive ? "text-green-500 animate-pulse" : "text-muted-foreground"
            )}
          />
          <span className="text-xs font-medium truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!readOnly && onSpeakerLabelsChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                Speakers
              </span>
              <Switch
                checked={speakerLabelsEnabled}
                onCheckedChange={onSpeakerLabelsChange}
                disabled={speakerToggleDisabled}
                className="scale-75"
              />
            </div>
          )}
          {!readOnly && isSessionActive && (
            <span className="text-[9px] text-green-600 font-medium whitespace-nowrap">
              Listening…
            </span>
          )}
        </div>
      </div>

      <ScrollArea className={maxHeightClass}>
        <div className="p-3 space-y-2">
          {!hasContent && (
            <p className="text-[10px] text-muted-foreground text-center py-4">
              {emptyMessage ??
                (isSessionActive
                  ? "Waiting for speech from system audio…"
                  : isCapturing
                    ? "Connecting to realtime transcription…"
                    : "Select Realtime mode and press Start to begin live transcription.")}
            </p>
          )}

          {segments.map((segment) => (
            <div key={segment.id}>
              {renderLine(segment.text, segment.speakerLabel)}
            </div>
          ))}

          {showPending &&
            renderLine(pendingDelta, pendingSpeakerLabel, true)}

          <div ref={bottomRef} aria-hidden className="h-px" />
        </div>
      </ScrollArea>
    </div>
  );
};
