import { CalendarIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components";
import { UpcomingCalendarMeeting } from "@/lib/calendar/google-calendar-api";
import { cn } from "@/lib/utils";

interface UpcomingCalendarMeetingsProps {
  configured: boolean;
  connected: boolean;
  meetings: UpcomingCalendarMeeting[];
  loading: boolean;
  connecting: boolean;
  error: string;
  disabled?: boolean;
  selectedClientName?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onSelectMeeting: (suggestedClientName: string) => void;
  embedded?: boolean;
}

export function UpcomingCalendarMeetings({
  configured,
  connected,
  meetings,
  loading,
  connecting,
  error,
  disabled = false,
  selectedClientName,
  onConnect,
  onDisconnect,
  onRefresh,
  onSelectMeeting,
  embedded = false,
}: UpcomingCalendarMeetingsProps) {
  if (!configured) {
    return (
      <div
        className={
          embedded
            ? "text-xs text-muted-foreground"
            : "rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs text-muted-foreground"
        }
      >
        Google Calendar is not configured in this build.
      </div>
    );
  }

  const controls = (
    <div className="flex items-center gap-1">
      {connected && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={disabled || loading}
          onClick={() => void onRefresh()}
        >
          <RefreshCwIcon className={cn("w-3 h-3", loading && "animate-spin")} />
        </Button>
      )}
      {connected ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={disabled || connecting}
          onClick={() => void onDisconnect()}
        >
          Disconnect
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={disabled || connecting}
          onClick={() => void onConnect()}
        >
          {connecting ? (
            <>
              <LoaderIcon className="w-3 h-3 mr-1 animate-spin" />
              Connecting…
            </>
          ) : (
            "Connect Google"
          )}
        </Button>
      )}
    </div>
  );

  const body = (
    <>
      {embedded && (
        <div className="flex items-center justify-end mb-2">{controls}</div>
      )}

      {error && <p className="text-xs text-red-600 leading-snug">{error}</p>}

      {!connected && !error && (
        <p className="text-xs text-muted-foreground">
          Connect Google Calendar to pick a client from your next meetings.
        </p>
      )}

      {connected && !loading && meetings.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          No upcoming meetings on your primary calendar.
        </p>
      )}

      {connected && meetings.length > 0 && (
        <div className="space-y-1.5">
          {meetings.map((meeting) => {
            const isSelected =
              selectedClientName?.trim() === meeting.suggestedClientName.trim();
            return (
              <button
                key={meeting.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectMeeting(meeting.suggestedClientName)}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                  "hover:bg-background/80 disabled:opacity-50 disabled:pointer-events-none",
                  isSelected
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/40 bg-background/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug line-clamp-2">
                    {meeting.title}
                  </p>
                  {meeting.startLabel && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {meeting.startLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  With {meeting.withWhom}
                </p>
                {isSelected && (
                  <p className="text-xs text-primary mt-1">
                    Client set to {meeting.suggestedClientName}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-2">{body}</div>;
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <CalendarIcon className="w-3.5 h-3.5" />
          Upcoming meetings
        </div>
        {controls}
      </div>
      {body}
    </div>
  );
}
