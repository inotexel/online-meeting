import { useEffect, useLayoutEffect, useRef } from "react";
import { ScrollArea } from "@/components";
import { RadioIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LiveTranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
}

interface LiveTranscriptProps {
  segments: LiveTranscriptSegment[];
  pendingDelta: string;
  isSessionActive: boolean;
  isCapturing?: boolean;
}

export const LiveTranscript = ({
  segments,
  pendingDelta,
  isSessionActive,
  isCapturing = false,
}: LiveTranscriptProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastSegmentText = segments[segments.length - 1]?.text ?? "";
  const showPending =
    pendingDelta.trim().length > 0 && pendingDelta.trim() !== lastSegmentText;
  const hasContent = segments.length > 0 || showPending;

  useLayoutEffect(() => {
    const viewport = bottomRef.current?.closest(
      "[data-slot='scroll-area-viewport']"
    ) as HTMLElement | null;

    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [segments, pendingDelta, showPending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [segments, showPending]);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <RadioIcon
            className={cn(
              "w-3.5 h-3.5",
              isSessionActive ? "text-green-500 animate-pulse" : "text-muted-foreground"
            )}
          />
          <span className="text-xs font-medium">Live Transcript</span>
        </div>
        {isSessionActive && (
          <span className="text-[9px] text-green-600 font-medium">Listening…</span>
        )}
      </div>

      <ScrollArea className="max-h-64">
        <div className="p-3 space-y-2">
          {!hasContent && (
            <p className="text-[10px] text-muted-foreground text-center py-4">
              {isSessionActive
                ? "Waiting for speech from system audio…"
                : isCapturing
                  ? "Connecting to realtime transcription…"
                  : "Select Realtime mode and press Start to begin live transcription."}
            </p>
          )}

          {segments.map((segment) => (
            <p
              key={segment.id}
              className="text-xs leading-relaxed text-foreground"
            >
              {segment.text}
            </p>
          ))}

          {showPending && (
            <p className="text-xs leading-relaxed text-muted-foreground italic">
              {pendingDelta}
            </p>
          )}

          <div ref={bottomRef} aria-hidden className="h-px" />
        </div>
      </ScrollArea>
    </div>
  );
};
