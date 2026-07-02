import { CoachSuggestion } from "@/lib/memory";
import { FileTextIcon, LoaderIcon, LightbulbIcon } from "lucide-react";

type CoachBlockedReason = "neo4j" | "client_name" | "ai_provider" | null;

interface VadWhisperView {
  text: string;
  why: string;
  stage?: string;
}

interface CoachPanelProps {
  suggestions: CoachSuggestion[];
  isLoading?: boolean;
  blockedReason?: CoachBlockedReason;
  statusMessage?: string;
  lastError?: string;
  /** VAD auto-detect whisper mode — one suggestion at a time */
  whisperMode?: boolean;
  whisper?: VadWhisperView | null;
  meetingStage?: string;
  /** Tighter padding when nested inside a collapsible idle state */
  compact?: boolean;
}

const typeLabel: Record<CoachSuggestion["type"], string> = {
  question: "Ask",
  objection: "Expect",
  reminder: "Remember",
  answer: "Answer",
  expect: "Expect",
  cite_doc: "From docs",
  gap: "Not in docs",
};

const blockedMessages: Record<Exclude<CoachBlockedReason, null>, string> = {
  neo4j: "Connect Neo4j in the Client memory bar above to enable coaching.",
  client_name:
    "Enter a client name before starting capture — memory and coach need it.",
  ai_provider:
    "Select an AI provider in Dev Space — coach uses it for suggestions.",
};

function DocSourceBlock({ item }: { item: CoachSuggestion }) {
  if (!item.fromDocSearch || !item.sourceExcerpt?.trim()) return null;

  return (
    <div className="mt-1.5 rounded-md border border-primary/25 bg-primary/5 p-2 space-y-1">
      <p className="text-[11px] font-semibold text-primary flex items-center gap-1">
        <FileTextIcon className="w-3.5 h-3.5" />
        From doc search
        {item.docSearchScore != null && (
          <span className="font-normal text-muted-foreground">
            · {(item.docSearchScore * 100).toFixed(0)}% match
          </span>
        )}
      </p>
      {item.sourceDocument && (
        <p className="text-[11px] font-medium text-foreground/80">
          {item.sourceDocument}
        </p>
      )}
      <p className="text-sm leading-relaxed text-foreground/90 border-l-2 border-primary/30 pl-2 italic">
        {item.sourceExcerpt}
      </p>
    </div>
  );
}

export const CoachPanel = ({
  suggestions,
  isLoading = false,
  blockedReason = null,
  statusMessage = "",
  lastError = "",
  whisperMode = false,
  whisper = null,
  meetingStage = "",
  compact = false,
}: CoachPanelProps) => {
  if (whisperMode) {
    return (
      <div
        className={
          compact
            ? "space-y-2"
            : "overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-muted/30 shadow-sm"
        }
      >
        {!compact && (
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <LightbulbIcon className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Closing whisper</span>
            </div>
            {isLoading && (
              <LoaderIcon className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
        )}

        <div className={compact ? "space-y-2" : "p-3 space-y-2.5"}>
          {compact && isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}
          {blockedReason && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              {blockedMessages[blockedReason]}
            </p>
          )}

          {lastError && !blockedReason && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
              {lastError}
            </p>
          )}

          {whisper ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                Say this
              </p>
              <p className="text-base leading-relaxed font-medium">
                {whisper.text}
              </p>
              {whisper.why && (
                <p className="text-sm text-muted-foreground border-l-2 border-primary/25 pl-2">
                  {whisper.why}
                </p>
              )}
            </div>
          ) : (
            !blockedReason &&
            !lastError && (
              <p className="text-sm text-muted-foreground">
                {compact
                  ? "Starts when you press Start — whispers appear only when they help close."
                  : statusMessage ||
                    "Listening to the prospect. A whisper appears only when it would help close."}
                {!compact && meetingStage && meetingStage !== "unknown" && (
                  <> · Stage: {meetingStage.replace("_", " ")}</>
                )}
              </p>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <LightbulbIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Live coach</span>
        </div>
        {isLoading && (
          <LoaderIcon className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="p-3 space-y-2">
        {blockedReason && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
            {blockedMessages[blockedReason]}
          </p>
        )}

        {lastError && !blockedReason && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            {lastError}
          </p>
        )}

        {statusMessage && !blockedReason && (
          <p className="text-sm text-muted-foreground">{statusMessage}</p>
        )}

        {!blockedReason &&
          !isLoading &&
          !statusMessage &&
          !lastError &&
          suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every 15s the coach reviews transcript + docs and suggests what
              to say or ask. Tips appear here when there is real speech.
            </p>
          )}

        {suggestions.map((item, index) => (
          <div
            key={`${item.type}-${index}`}
            className="rounded-md border border-border/40 bg-background/60 p-2.5 space-y-1"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                {typeLabel[item.type]}
              </span>
              {item.fromDocSearch && (
                <span className="text-[10px] uppercase tracking-wide rounded bg-primary/10 text-primary px-1.5 py-0.5">
                  Doc RAG
                </span>
              )}
            </div>
            <p className="text-base leading-relaxed">{item.text}</p>
            <p className="text-sm text-muted-foreground">{item.reason}</p>
            <DocSourceBlock item={item} />
          </div>
        ))}
      </div>
    </div>
  );
};
