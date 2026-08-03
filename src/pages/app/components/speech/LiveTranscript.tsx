import { RadioIcon } from "lucide-react";

import { Switch } from "@/components";

import { cn } from "@/lib/utils";

/** Re-enable when speaker diarization toggle should appear in the realtime UI. */
const SHOW_SPEAKER_TOGGLE = false;



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

  isProcessing?: boolean;

  showSpeakerLabels?: boolean;

  speakerLabelsEnabled?: boolean;

  onSpeakerLabelsChange?: (enabled: boolean) => void;

  speakerToggleDisabled?: boolean;

  readOnly?: boolean;

  title?: string;

  emptyMessage?: string;

  /** `caption` shows only the current utterance; `scroll` keeps full history */

  displayMode?: "caption" | "scroll";

  maxHeightClass?: string;

  /** Title + caption only — no header bar, radio icon, or "Listening…" */
  minimal?: boolean;

}



export function formatSpeakerLabel(label?: string | null): string | null {

  if (!label || label === "UNKNOWN") return null;

  if (label === "user") return "You";

  if (label === "client") return "Client";

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

  isProcessing = false,

  showSpeakerLabels = false,

  speakerLabelsEnabled = false,

  onSpeakerLabelsChange,

  speakerToggleDisabled = false,

  readOnly = false,

  title = "Live Transcript",

  emptyMessage,

  displayMode = "caption",

  maxHeightClass = "max-h-64",

  minimal = false,

}: LiveTranscriptProps) => {

  const pendingText = pendingDelta.trim();

  const lastSegment = segments[segments.length - 1];

  const captionText = pendingText || lastSegment?.text || "";

  const captionSpeaker = pendingText

    ? pendingSpeakerLabel

    : lastSegment?.speakerLabel;

  const isCaptionPending = pendingText.length > 0;

  const hasContent =

    displayMode === "caption"

      ? captionText.length > 0

      : segments.length > 0 || pendingText.length > 0;



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

          "text-base leading-relaxed",

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



  if (minimal) {

    return (

      <div className="space-y-1.5">

        <p className="text-sm font-medium text-foreground">{title}</p>

        <div className="min-h-[2.5rem]">

          {hasContent

            ? renderLine(captionText, captionSpeaker, isCaptionPending)

            : emptyMessage ? (

                <p className="text-sm text-muted-foreground">{emptyMessage}</p>

              ) : null}

        </div>

      </div>

    );

  }



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

          <span className="text-sm font-medium truncate">{title}</span>

        </div>

        <div className="flex items-center gap-2 flex-shrink-0">

          {SHOW_SPEAKER_TOGGLE && !readOnly && onSpeakerLabelsChange && (

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

          {!readOnly && isProcessing && (
            <span className="text-[9px] text-amber-600 font-medium whitespace-nowrap">
              Transcribing…
            </span>
          )}

          {!readOnly && !isProcessing && isSessionActive && (

            <span className="text-[9px] text-green-600 font-medium whitespace-nowrap">

              Listening…

            </span>

          )}

        </div>

      </div>



      {displayMode === "caption" ? (

        <div className="min-h-[4rem] p-3 flex items-center">

          {!hasContent ? (

            <p className="text-sm text-muted-foreground text-center w-full py-1">

              {emptyMessage ??

                (isProcessing

                  ? "Transcribing speech…"

                  : isSessionActive

                  ? "Waiting for speech from system audio…"

                  : isCapturing

                    ? "Connecting to realtime transcription…"

                    : "Select Realtime mode and press Start to begin live transcription.")}

            </p>

          ) : (

            renderLine(captionText, captionSpeaker, isCaptionPending)

          )}

        </div>

      ) : (

        <div className={cn("overflow-y-auto", maxHeightClass)}>

          <div className="p-3 space-y-2">

            {!hasContent && (

              <p className="text-sm text-muted-foreground text-center py-4">

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



            {pendingText.length > 0 &&

              renderLine(pendingDelta, pendingSpeakerLabel, true)}

          </div>

        </div>

      )}

    </div>

  );

};


