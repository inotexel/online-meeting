import { Button, Input } from "@/components";
import { DatabaseIcon } from "lucide-react";

interface ClientContextBarProps {
  clientName: string;
  onClientNameChange: (name: string) => void;
  knowledgeConfigured: boolean;
  knowledgeStatus: "unknown" | "connected" | "error";
  onTestConnection: () => Promise<unknown>;
  meetingCount?: number;
  disabled?: boolean;
}

export const ClientContextBar = ({
  clientName,
  onClientNameChange,
  knowledgeConfigured,
  knowledgeStatus,
  onTestConnection,
  meetingCount,
  disabled = false,
}: ClientContextBarProps) => {
  if (!knowledgeConfigured) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] text-amber-900">
        Neo4j not configured. Add `NEO4J_URI` and `NEO4J_PASSWORD` to
        `src-tauri/.env`, then restart the app.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium">
          <DatabaseIcon className="w-3.5 h-3.5" />
          Client memory
        </div>
        <span
          className={
            knowledgeStatus === "connected"
              ? "text-[9px] text-green-600"
              : knowledgeStatus === "error"
                ? "text-[9px] text-red-600"
                : "text-[9px] text-muted-foreground"
          }
        >
          {knowledgeStatus === "connected"
            ? "Neo4j connected"
            : knowledgeStatus === "error"
              ? "Neo4j error"
              : "Not tested"}
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Client name (e.g. Acme Corp)"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          disabled={disabled}
          className="h-7 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[10px] shrink-0"
          disabled={disabled}
          onClick={() => void onTestConnection()}
        >
          Test
        </Button>
      </div>

      {typeof meetingCount === "number" && clientName.trim() && (
        <p className="text-[9px] text-muted-foreground">
          Prior meetings in graph: {meetingCount}. Next capture starts meeting #
          {meetingCount + 1}.
        </p>
      )}
    </div>
  );
};
