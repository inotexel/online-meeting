import {
  AudioWaveformIcon,
  CalendarIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
  LightbulbIcon,
  RadioIcon,
} from "lucide-react";
import { VadConfig } from "@/hooks/useSystemAudio";
import { KnownClient } from "@/lib/memory";
import {
  SybillSyncProgress,
  SybillSyncResult,
} from "@/lib/sybill";
import { UpcomingCalendarMeeting } from "@/lib/calendar/google-calendar-api";
import { ClientGraphContext } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { CollapsibleCard } from "./CollapsibleCard";
import { CoachPanel } from "./CoachPanel";
import { LiveTranscript, LiveTranscriptSegment } from "./LiveTranscript";
import { ClientContextBar } from "./ClientContextBar";
import { ClientDocuments } from "./ClientDocuments";
import { SybillSyncBar } from "./SybillSyncBar";
import { UpcomingCalendarMeetings } from "./UpcomingCalendarMeetings";

type CoachBlockedReason = "neo4j" | "client_name" | "ai_provider" | null;

interface VadWhisperView {
  text: string;
  why: string;
  stage?: string;
}

interface MeetingCoachLayoutProps {
  captureMode: "vad" | "realtime";
  capturing: boolean;
  vadConfig: VadConfig;
  onUpdateVadConfig: (config: VadConfig) => void;
  // Live capture (realtime)
  isRealtimeSessionActive: boolean;
  realtimeSegments: LiveTranscriptSegment[];
  realtimePendingDelta: string;
  realtimePendingSpeakerLabel?: string | null;
  // Whisper coach
  whisper: VadWhisperView | null;
  lastProspectLine: string;
  meetingStage: string;
  isThinking: boolean;
  isMemorySyncing: boolean;
  whisperBlockedReason?: CoachBlockedReason;
  whisperStatus: string;
  whisperError: string;
  // Client + memory
  meetingClientName: string;
  onClientNameChange: (name: string) => void;
  knowledgeConfigured: boolean;
  knowledgeStatus: "unknown" | "connected" | "error";
  clientGraphContext: ClientGraphContext | null;
  knownClients: KnownClient[];
  onTestConnection: () => Promise<unknown>;
  openaiApiKey?: string;
  // Sybill
  sybillApiKey: string;
  onSybillApiKeyChange: (key: string) => void;
  sybillSyncing: boolean;
  sybillStatus: string;
  sybillResult: SybillSyncResult | null;
  sybillCard: SybillSyncProgress | null;
  onSybillSync: () => Promise<unknown>;
  onSybillCancel: () => void;
  // Calendar
  calendarConfigured: boolean;
  calendarConnected: boolean;
  calendarMeetings: UpcomingCalendarMeeting[];
  calendarLoading: boolean;
  calendarConnecting: boolean;
  calendarError: string;
  onCalendarConnect: () => void;
  onCalendarDisconnect: () => void;
  onCalendarRefresh: () => void;
  onSelectCalendarMeeting: (name: string) => void;
}

const CAPTURE_COPY = {
  vad: {
    title: "Auto-detect",
    subtitle: "Captures prospect speech when they pause — then whispers coaching lines.",
    icon: AudioWaveformIcon,
  },
  realtime: {
    title: "Realtime transcript",
    subtitle: "Live word-by-word transcript from system audio — same closing coach.",
    icon: RadioIcon,
  },
} as const;

export function MeetingCoachLayout({
  captureMode,
  capturing,
  vadConfig,
  onUpdateVadConfig,
  isRealtimeSessionActive,
  realtimeSegments,
  realtimePendingDelta,
  realtimePendingSpeakerLabel,
  whisper,
  lastProspectLine,
  meetingStage,
  isThinking,
  isMemorySyncing,
  whisperBlockedReason,
  whisperStatus,
  whisperError,
  meetingClientName,
  onClientNameChange,
  knowledgeConfigured,
  knowledgeStatus,
  clientGraphContext,
  knownClients,
  onTestConnection,
  openaiApiKey,
  sybillApiKey,
  onSybillApiKeyChange,
  sybillSyncing,
  sybillStatus,
  sybillResult,
  sybillCard,
  onSybillSync,
  onSybillCancel,
  calendarConfigured,
  calendarConnected,
  calendarMeetings,
  calendarLoading,
  calendarConnecting,
  calendarError,
  onCalendarConnect,
  onCalendarDisconnect,
  onCalendarRefresh,
  onSelectCalendarMeeting,
}: MeetingCoachLayoutProps) {
  const capture = CAPTURE_COPY[captureMode];
  const CaptureIcon = capture.icon;
  const setupDisabled = capturing;
  const prepDefaultOpen = !capturing;

  const clientBadge = meetingClientName.trim()
    ? meetingClientName.trim()
    : "Set client";
  const clientBadgeVariant = meetingClientName.trim() ? "success" : "warning";

  const docCountLabel = meetingClientName.trim() ? "Upload sheets" : "Needs client";

  const coachPanel = (
    <CoachPanel
      suggestions={[]}
      whisperMode
      whisper={whisper}
      meetingStage={meetingStage}
      isLoading={isThinking || isMemorySyncing}
      blockedReason={whisperBlockedReason}
      statusMessage={whisperStatus}
      lastError={whisperError}
      compact={!capturing}
    />
  );

  const liveAudioBody =
    captureMode === "realtime" ? (
      <LiveTranscript
        segments={realtimeSegments}
        pendingDelta={realtimePendingDelta}
        pendingSpeakerLabel={realtimePendingSpeakerLabel}
        isSessionActive={isRealtimeSessionActive}
        isCapturing={capturing}
        showSpeakerLabels={!vadConfig.realtime_speaker_labels}
        speakerLabelsEnabled={Boolean(vadConfig.realtime_speaker_labels)}
        onSpeakerLabelsChange={(enabled) =>
          onUpdateVadConfig({
            ...vadConfig,
            realtime_speaker_labels: enabled,
          })
        }
        speakerToggleDisabled={isRealtimeSessionActive}
      />
    ) : (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              capturing ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          <p className="text-sm text-foreground/90">
            {capturing
              ? "Listening — a new chunk is sent when the prospect stops talking."
              : "Transcript appears here once you press Start."}
          </p>
        </div>
        {lastProspectLine && (
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Last captured line
            </p>
            <p className="text-sm leading-relaxed">{lastProspectLine}</p>
          </div>
        )}
      </div>
    );

  const meetingPrep = (
    <div>
      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Meeting prep
      </p>
      <div className="space-y-2">
        <CollapsibleCard
          title="Client"
          subtitle="Neo4j memory for this deal"
          icon={DatabaseIcon}
          badge={clientBadge}
          badgeVariant={clientBadgeVariant}
          defaultOpen={prepDefaultOpen && !meetingClientName.trim()}
          disabled={setupDisabled}
        >
          <ClientContextBar
            embedded
            clientName={meetingClientName}
            onClientNameChange={onClientNameChange}
            knowledgeConfigured={knowledgeConfigured}
            knowledgeStatus={knowledgeStatus}
            onTestConnection={onTestConnection}
            meetingCount={clientGraphContext?.meetingCount}
            knownClients={knownClients}
            disabled={setupDisabled}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Cheat sheets"
          subtitle="Deal docs for live retrieval"
          icon={FileTextIcon}
          badge={docCountLabel}
          badgeVariant={meetingClientName.trim() ? "default" : "warning"}
          defaultOpen={false}
          disabled={setupDisabled}
        >
          <ClientDocuments
            embedded
            clientName={meetingClientName}
            openaiApiKey={openaiApiKey}
            knowledgeConfigured={knowledgeConfigured}
            disabled={setupDisabled}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Sybill"
          subtitle="Import past call memory"
          icon={CloudIcon}
          badge={sybillApiKey.trim() ? "Connected" : "API key"}
          badgeVariant={sybillApiKey.trim() ? "success" : "muted"}
          defaultOpen={false}
          disabled={setupDisabled}
        >
          <SybillSyncBar
            embedded
            apiKey={sybillApiKey}
            onApiKeyChange={onSybillApiKeyChange}
            knowledgeConfigured={knowledgeConfigured}
            syncing={sybillSyncing}
            status={sybillStatus}
            result={sybillResult}
            card={sybillCard}
            onSync={onSybillSync}
            onCancel={onSybillCancel}
            disabled={setupDisabled}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Calendar"
          subtitle="Pick today's meeting client"
          icon={CalendarIcon}
          badge={
            calendarConnected
              ? `${calendarMeetings.length} upcoming`
              : calendarConfigured
                ? "Connect"
                : "Optional"
          }
          badgeVariant={calendarConnected ? "success" : "muted"}
          defaultOpen={false}
          disabled={setupDisabled}
        >
          <UpcomingCalendarMeetings
            embedded
            configured={calendarConfigured}
            connected={calendarConnected}
            meetings={calendarMeetings}
            loading={calendarLoading}
            connecting={calendarConnecting}
            error={calendarError}
            disabled={setupDisabled}
            selectedClientName={meetingClientName}
            onConnect={onCalendarConnect}
            onDisconnect={onCalendarDisconnect}
            onRefresh={onCalendarRefresh}
            onSelectMeeting={onSelectCalendarMeeting}
          />
        </CollapsibleCard>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {capturing ? (
        <>
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/50 to-muted/20 p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-border/50">
                <CaptureIcon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{capture.title}</h3>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Live
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {capture.subtitle}
                </p>
              </div>
            </div>
          </div>

          {coachPanel}

          <CollapsibleCard
            title="Live audio"
            subtitle={
              captureMode === "realtime"
                ? "Streaming transcript from the call"
                : "Detecting speech after each pause"
            }
            icon={CaptureIcon}
            badge="Recording"
            badgeVariant="success"
            defaultOpen
            highlight
          >
            {liveAudioBody}
          </CollapsibleCard>

          {meetingPrep}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/50">
              <CaptureIcon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{capture.title}</p>
              <p className="text-xs text-muted-foreground">
                Set up client below, then press Start in the header.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Ready
            </span>
          </div>

          {meetingPrep}

          <CollapsibleCard
            title="Closing whisper"
            subtitle="Coaching lines appear during the call"
            icon={LightbulbIcon}
            badge="Idle"
            badgeVariant="muted"
            defaultOpen={false}
          >
            {coachPanel}
          </CollapsibleCard>

          <CollapsibleCard
            title="Live audio"
            subtitle={
              captureMode === "realtime"
                ? "Streaming transcript from the call"
                : "Detecting speech after each pause"
            }
            icon={CaptureIcon}
            badge="Idle"
            badgeVariant="muted"
            defaultOpen={false}
          >
            {liveAudioBody}
          </CollapsibleCard>
        </>
      )}
    </div>
  );
}
