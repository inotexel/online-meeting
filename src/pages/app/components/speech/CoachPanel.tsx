import { CoachSuggestion } from "@/lib/memory";

import { FileTextIcon, LoaderIcon, LightbulbIcon } from "lucide-react";

type CoachBlockedReason = "neo4j" | "client_name" | "ai_provider" | null;

interface CoachPanelProps {
  suggestions: CoachSuggestion[];
  isLoading?: boolean;
  blockedReason?: CoachBlockedReason;
  statusMessage?: string;
  lastError?: string;
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
      <p className="text-[9px] font-semibold text-primary flex items-center gap-1">
        <FileTextIcon className="w-3 h-3" />
        From doc search
        {item.docSearchScore != null && (
          <span className="font-normal text-muted-foreground">
            · {(item.docSearchScore * 100).toFixed(0)}% match
          </span>
        )}
      </p>
      {item.sourceDocument && (
        <p className="text-[9px] font-medium text-foreground/80">
          {item.sourceDocument}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-foreground/90 border-l-2 border-primary/30 pl-2 italic">
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
}: CoachPanelProps) => {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <LightbulbIcon className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium">Live coach</span>
        </div>
        {isLoading && (
          <LoaderIcon className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="p-3 space-y-2">
        {blockedReason && (
          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
            {blockedMessages[blockedReason]}
          </p>
        )}

        {lastError && !blockedReason && (
          <p className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            {lastError}
          </p>
        )}

        {statusMessage && !blockedReason && (
          <p className="text-[10px] text-muted-foreground">{statusMessage}</p>
        )}

        {!blockedReason &&
          !isLoading &&
          !statusMessage &&
          !lastError &&
          suggestions.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
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
              <span className="text-[9px] font-semibold uppercase tracking-wide text-primary">
                {typeLabel[item.type]}
              </span>
              {item.fromDocSearch && (
                <span className="text-[8px] uppercase tracking-wide rounded bg-primary/10 text-primary px-1.5 py-0.5">
                  Doc RAG
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed">{item.text}</p>
            <p className="text-[10px] text-muted-foreground">{item.reason}</p>
            <DocSourceBlock item={item} />
          </div>
        ))}
      </div>
    </div>
  );
};
