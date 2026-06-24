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
}: UpcomingCalendarMeetingsProps) {
  if (!configured) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-[10px] text-muted-foreground">
        Add <span className="font-mono">GOOGLE_CLIENT_ID</span> to{" "}
        <span className="font-mono">src-tauri/.env</span> to enable Google
        Calendar. Use redirect URI{" "}
        <span className="font-mono">http://127.0.0.1:14528/callback</span> in
        Google Cloud Console.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium">
          <CalendarIcon className="w-3.5 h-3.5" />
          Upcoming meetings
        </div>
        <div className="flex items-center gap-1">
          {connected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[9px]"
              disabled={disabled || loading}
              onClick={() => void onRefresh()}
            >
              <RefreshCwIcon
                className={cn("w-3 h-3", loading && "animate-spin")}
              />
            </Button>
          )}
          {connected ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[9px]"
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
              className="h-6 px-2 text-[9px]"
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
      </div>

      {error && (
        <p className="text-[9px] text-red-600 leading-snug">{error}</p>
      )}

      {!connected && !error && (
        <p className="text-[9px] text-muted-foreground">
          Connect Google Calendar to pick a client from your next meetings.
        </p>
      )}

      {connected && !loading && meetings.length === 0 && !error && (
        <p className="text-[9px] text-muted-foreground">
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
                  "w-full text-left rounded-md border px-2 py-1.5 transition-colors",
                  "hover:bg-background/80 disabled:opacity-50 disabled:pointer-events-none",
                  isSelected
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/40 bg-background/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] font-medium leading-snug line-clamp-2">
                    {meeting.title}
                  </p>
                  {meeting.startLabel && (
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {meeting.startLabel}
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">
                  With {meeting.withWhom}
                </p>
                {isSelected && (
                  <p className="text-[9px] text-primary mt-0.5">
                    Client set to {meeting.suggestedClientName}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
