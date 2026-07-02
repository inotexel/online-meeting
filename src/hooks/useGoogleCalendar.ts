import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchUpcomingCalendarMeetings,
  getCalendarStatus,
  UpcomingCalendarMeeting,
} from "@/lib/calendar/google-calendar-api";

function dedupeMeetings(
  meetings: UpcomingCalendarMeeting[]
): UpcomingCalendarMeeting[] {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const unique: UpcomingCalendarMeeting[] = [];

  for (const meeting of meetings) {
    const contentKey = [
      meeting.startLabel.trim().toLowerCase(),
      meeting.title.trim().toLowerCase(),
      meeting.withWhom.trim().toLowerCase(),
      meeting.suggestedClientName.trim().toLowerCase(),
    ].join("|");

    if (meeting.id && seenIds.has(meeting.id)) continue;
    if (contentKey && seenContent.has(contentKey)) continue;

    if (meeting.id) seenIds.add(meeting.id);
    if (contentKey) seenContent.add(contentKey);
    unique.push(meeting);
  }

  return unique;
}

export function useGoogleCalendar(enabled: boolean) {
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [meetings, setMeetings] = useState<UpcomingCalendarMeeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      setConfigured(status.configured);
      setConnected(status.connected);
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { configured: false, connected: false };
    }
  }, []);

  const refreshMeetings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const status = await refreshStatus();
      if (!status.connected) {
        setMeetings([]);
        return;
      }
      const upcoming = dedupeMeetings(await fetchUpcomingCalendarMeetings());
      setMeetings(upcoming);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      await connectGoogleCalendar();
      setConnected(true);
      await refreshMeetings();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setConnecting(false);
    }
  }, [refreshMeetings]);

  const disconnect = useCallback(async () => {
    setError("");
    try {
      await disconnectGoogleCalendar();
      setConnected(false);
      setMeetings([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refreshStatus();
  }, [enabled, refreshStatus]);

  useEffect(() => {
    if (!enabled || !connected) return;
    void refreshMeetings();
  }, [enabled, connected, refreshMeetings]);

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen("google-calendar-connected", () => {
        setConnected(true);
        void refreshMeetings();
      });
    };
    void setup();
    return () => {
      unlisten?.();
    };
  }, [enabled, refreshMeetings]);

  return {
    configured,
    connected,
    meetings,
    loading,
    connecting,
    error,
    connect,
    disconnect,
    refreshMeetings,
  };
}
