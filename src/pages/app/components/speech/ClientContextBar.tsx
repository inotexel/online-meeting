import { Button, Input } from "@/components";
import { KnownClient } from "@/lib/memory";
import { DatabaseIcon } from "lucide-react";

interface ClientContextBarProps {
  clientName: string;
  onClientNameChange: (name: string) => void;
  knowledgeConfigured: boolean;
  knowledgeStatus: "unknown" | "connected" | "error";
  onTestConnection: () => Promise<unknown>;
  meetingCount?: number;
  knownClients?: KnownClient[];
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
  knownClients = [],
  disabled = false,
  embedded = false,
}: ClientContextBarProps) => {
  if (!knowledgeConfigured) {
    return (
      <div
        className={
          embedded
            ? "text-sm text-amber-900"
            : "rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        }
      >
        Neo4j not configured. Add `NEO4J_URI` and `NEO4J_PASSWORD` to
        `src-tauri/.env`, then restart the app.
      </div>
    );
  }

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
          placeholder="Client name (e.g. Acme Corp)"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
          list="known-clients"
        />
        <datalist id="known-clients">
          {knownClients.map((client, index) => (
            <option
              key={`${client.clientId}-${index}`}
              value={client.clientName}
            >
              {client.meetingCount} meeting
              {client.meetingCount === 1 ? "" : "s"}
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
      </div>

      {typeof meetingCount === "number" && clientName.trim() && (
        <p className="text-xs text-muted-foreground">
          Prior meetings in graph: {meetingCount}. Next capture starts meeting #
          {meetingCount + 1}.
        </p>
      )}
    </div>
  );
};
