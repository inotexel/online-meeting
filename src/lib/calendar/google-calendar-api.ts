import { invoke } from "@tauri-apps/api/core";

export interface UpcomingCalendarMeeting {
  id: string;
  title: string;
  withWhom: string;
  suggestedClientName: string;
  startLabel: string;
}

export interface CalendarStatus {
  configured: boolean;
  connected: boolean;
}

export async function getCalendarStatus(): Promise<CalendarStatus> {
  return invoke<CalendarStatus>("calendar_get_status");
}

export async function isCalendarConfigured(): Promise<boolean> {
  return invoke<boolean>("calendar_is_configured");
}

export async function connectGoogleCalendar(): Promise<void> {
  return invoke("calendar_connect");
}

export async function disconnectGoogleCalendar(): Promise<void> {
  return invoke("calendar_disconnect");
}

export async function fetchUpcomingCalendarMeetings(): Promise<
  UpcomingCalendarMeeting[]
> {
  return invoke<UpcomingCalendarMeeting[]>("calendar_fetch_upcoming");
}

export async function getCalendarRedirectUri(): Promise<string> {
  return invoke<string>("calendar_redirect_uri");
}
