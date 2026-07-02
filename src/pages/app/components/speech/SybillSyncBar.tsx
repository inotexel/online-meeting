import { useState } from "react";
import { Button, Input } from "@/components";
import {
  SybillInsight,
  SybillSyncProgress,
  SybillSyncResult,
} from "@/lib/sybill";
import {
  CheckCircle2Icon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  HelpCircleIcon,
  InfoIcon,
  ListChecksIcon,
  LoaderIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SkipForwardIcon,
  UserIcon,
} from "lucide-react";

interface SybillSyncBarProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  knowledgeConfigured: boolean;
  syncing: boolean;
  status: string;
  result: SybillSyncResult | null;
  card: SybillSyncProgress | null;
  onSync: () => Promise<unknown>;
  onCancel: () => void;
  disabled?: boolean;
  embedded?: boolean;
}

function formatCardDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const INSIGHT_META: Record<
  SybillInsight["kind"],
  { label: string; icon: typeof InfoIcon; className: string }
> = {
  fact: {
    label: "Fact",
    icon: InfoIcon,
    className: "text-sky-600",
  },
  objection: {
    label: "Objection",
    icon: ShieldAlertIcon,
    className: "text-rose-600",
  },
  question: {
    label: "Question",
    icon: HelpCircleIcon,
    className: "text-violet-600",
  },
  action: {
    label: "Action",
    icon: ListChecksIcon,
    className: "text-emerald-600",
  },
};

const InsightRow = ({ insight }: { insight: SybillInsight }) => {
  const meta = INSIGHT_META[insight.kind];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-2">
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.className}`} />
      <p className="text-sm leading-snug text-foreground/90">{insight.text}</p>
    </div>
  );
};

const ImportCard = ({ card }: { card: SybillSyncProgress }) => {
  const imported = card.action === "imported";
  const date = formatCardDate(card.meetingDate);
  const insights = card.insights ?? [];

  return (
    <div
      key={card.scanned}
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
        {imported ? (
          <CheckCircle2Icon className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <SkipForwardIcon className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {imported ? "Importing meeting" : "Already synced"}
        </span>
      </div>

      <div className="p-3">
        {card.clientName && (
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <UserIcon className="w-4 h-4 shrink-0 text-primary" />
            <span className="truncate">{card.clientName}</span>
          </div>
        )}

        {card.title && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {card.title}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {date && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
              {date}
            </span>
          )}
          {card.callType && (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 capitalize text-primary">
              {card.callType}
            </span>
          )}
          {imported &&
            typeof card.factCount === "number" &&
            card.factCount > 0 && (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-600">
                {card.factCount} insight{card.factCount === 1 ? "" : "s"}
              </span>
            )}
        </div>

        {insights.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
            {insights.slice(0, 5).map((insight, idx) => (
              <InsightRow key={idx} insight={insight} />
            ))}
            {insights.length > 5 && (
              <p className="text-xs text-muted-foreground pl-5">
                +{insights.length - 5} more saved to memory
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        {card.imported} imported · {card.skipped} skipped · {card.scanned}{" "}
        scanned
      </div>
    </div>
  );
};

export const SybillSyncBar = ({
  apiKey,
  onApiKeyChange,
  knowledgeConfigured,
  syncing,
  status,
  result,
  card,
  onSync,
  onCancel,
  disabled = false,
  embedded = false,
}: SybillSyncBarProps) => {
  const [showKey, setShowKey] = useState(false);

  return (
    <div
      className={
        embedded
          ? "space-y-2.5"
          : "rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2.5"
      }
    >
      {!embedded && (
        <div className="flex items-center gap-2 text-sm font-medium">
          <CloudIcon className="w-4 h-4" />
          Sybill — learn from past calls
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showKey ? "text" : "password"}
            placeholder="Sybill API key (sk_live_…)"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            disabled={disabled || syncing}
            className="h-8 text-sm pr-8"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowKey((v) => !v)}
            tabIndex={-1}
          >
            {showKey ? (
              <EyeOffIcon className="w-4 h-4" />
            ) : (
              <EyeIcon className="w-4 h-4" />
            )}
          </button>
        </div>

        {syncing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs shrink-0"
            onClick={onCancel}
          >
            <LoaderIcon className="w-3.5 h-3.5 mr-1 animate-spin" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs shrink-0"
            disabled={disabled || !apiKey.trim() || !knowledgeConfigured}
            onClick={() => void onSync()}
          >
            <RefreshCwIcon className="w-3.5 h-3.5 mr-1" />
            Sync
          </Button>
        )}
      </div>

      {!knowledgeConfigured && (
        <p className="text-xs text-amber-600">
          Neo4j not configured — meetings can't be stored yet.
        </p>
      )}

      {syncing && card && <ImportCard card={card} />}

      {syncing && !card && status && (
        <p className="text-xs text-muted-foreground line-clamp-2">{status}</p>
      )}

      {result && !syncing && (
        <p className="text-xs text-muted-foreground">
          {result.imported} imported · {result.skipped} already synced ·{" "}
          {result.scanned} scanned
          {result.clients.length > 0 && (
            <> · clients: {result.clients.slice(0, 4).join(", ")}</>
          )}
        </p>
      )}
    </div>
  );
};
