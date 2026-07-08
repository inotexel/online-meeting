import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/components";
import { KnownClient } from "@/lib/memory";
import { DatabaseIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";

interface ClientContextBarProps {
  clientName: string;
  onClientNameChange: (name: string) => void;
  knowledgeConfigured: boolean;
  knowledgeStatus: "unknown" | "connected" | "error";
  onTestConnection: () => Promise<unknown>;
  meetingCount?: number;
  recentUtteranceCount?: number;
  resolvedGraphId?: string;
  knownClients?: KnownClient[];
  onRefreshClients?: () => Promise<unknown>;
  disabled?: boolean;
  embedded?: boolean;
}

export const ClientContextBar = ({
  clientName,
  onClientNameChange,
  knowledgeConfigured,
  knowledgeStatus,
  onTestConnection,
  meetingCount,
  recentUtteranceCount,
  resolvedGraphId,
  knownClients = [],
  onRefreshClients,
  disabled = false,
  embedded = false,
}: ClientContextBarProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshClients = useCallback(async () => {
    if (!onRefreshClients) return;
    setIsRefreshing(true);
    try {
      await onRefreshClients();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshClients]);

  useEffect(() => {
    if (knowledgeConfigured && onRefreshClients) {
      void refreshClients();
    }
  }, [knowledgeConfigured, onRefreshClients, refreshClients]);

  if (!knowledgeConfigured) {
    return (
      <div
        className={
          embedded
            ? "text-sm text-amber-900"
            : "rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        }
      >
        Neo4j is not configured in this build. Contact your administrator.
      </div>
    );
  }

  const trimmedName = clientName.trim();
  const matchedClient = knownClients.find(
    (c) =>
      c.clientName.toLowerCase() === trimmedName.toLowerCase() ||
      c.clientId === resolvedGraphId
  );
  const effectiveMeetingCount =
    typeof meetingCount === "number" && meetingCount > 0
      ? meetingCount
      : matchedClient?.meetingCount ?? meetingCount;

  return (
    <div
      className={
        embedded
          ? "space-y-2.5"
          : "rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2.5"
      }
    >
      {!embedded && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <DatabaseIcon className="w-4 h-4" />
            Client memory
          </div>
          <span
            className={
              knowledgeStatus === "connected"
                ? "text-xs text-green-600"
                : knowledgeStatus === "error"
                  ? "text-xs text-red-600"
                  : "text-xs text-muted-foreground"
            }
          >
            {knowledgeStatus === "connected"
              ? "Neo4j connected"
              : knowledgeStatus === "error"
                ? "Neo4j error"
                : "Not tested"}
          </span>
        </div>
      )}

      {embedded && (
        <p
          className={
            knowledgeStatus === "connected"
              ? "text-xs text-green-600"
              : knowledgeStatus === "error"
                ? "text-xs text-red-600"
                : "text-xs text-muted-foreground"
          }
        >
          {knowledgeStatus === "connected"
            ? "Neo4j connected"
            : knowledgeStatus === "error"
              ? "Neo4j connection error"
              : "Test connection after entering client name"}
        </p>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Client name (e.g. irsaam)"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
          list="known-clients"
        />
        <datalist id="known-clients">
          {knownClients.map((client) => (
            <option key={client.clientId} value={client.clientName}>
              {client.meetingCount} meeting
              {client.meetingCount === 1 ? "" : "s"} · {client.clientId}
            </option>
          ))}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs shrink-0"
          disabled={disabled}
          onClick={() => void onTestConnection()}
        >
          Test
        </Button>
        {onRefreshClients && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            disabled={disabled || isRefreshing}
            title="Refresh client list from Neo4j"
            onClick={() => void refreshClients()}
          >
            {isRefreshing ? (
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Clients in graph ({knownClients.length})
          </p>
        </div>
        {knownClients.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 px-2.5 py-2">
            No clients loaded. Press refresh or Test — if empty, ingest a
            meeting or upload docs for a client first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {knownClients.map((client) => {
              const isSelected =
                trimmedName.toLowerCase() === client.clientName.toLowerCase();
              return (
                <button
                  key={client.clientId}
                  type="button"
                  disabled={disabled}
                  onClick={() => onClientNameChange(client.clientName)}
                  className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background/80 hover:bg-muted/50"
                  }`}
                >
                  <span className="font-medium">{client.clientName}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {client.meetingCount} meeting
                    {client.meetingCount === 1 ? "" : "s"} · {client.clientId}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {trimmedName && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {resolvedGraphId && (
            <p>
              Graph id: <span className="font-mono text-foreground/80">{resolvedGraphId}</span>
            </p>
          )}
          {typeof effectiveMeetingCount === "number" && (
            <p>
              Prior meetings in graph: {effectiveMeetingCount}. Next capture starts meeting #
              {effectiveMeetingCount + 1}.
            </p>
          )}
          {matchedClient && matchedClient.clientId !== resolvedGraphId && (
            <p className="text-amber-700">
              List shows {matchedClient.clientId} — context may still be loading.
            </p>
          )}
          {effectiveMeetingCount === 0 &&
            matchedClient &&
            !(recentUtteranceCount && recentUtteranceCount > 0) && (
            <p>
              Client exists in Neo4j but has no linked meetings yet — import from
              Sybill or run a captured call with memory sync.
            </p>
          )}
          {effectiveMeetingCount === 0 &&
            recentUtteranceCount &&
            recentUtteranceCount > 0 && (
            <p className="text-amber-700">
              Found {recentUtteranceCount} prior utterance
              {recentUtteranceCount === 1 ? "" : "s"} in the graph — meeting
              links were repaired. Refresh if counts still look wrong.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
