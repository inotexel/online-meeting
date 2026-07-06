import {
  CalendarIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
} from "lucide-react";
import { Switch } from "@/components";
import { VadConfig, shouldCaptureUserMic } from "@/hooks/useSystemAudio";
import { KnownClient } from "@/lib/memory";
import {
  SybillSyncProgress,
  SybillSyncResult,
} from "@/lib/sybill";
import { UpcomingCalendarMeeting } from "@/lib/calendar/google-calendar-api";
import { ClientGraphContext } from "@/lib/memory/types";
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
  // Live capture (realtime + VAD transcript)
  isRealtimeSessionActive: boolean;
  realtimeSegments: LiveTranscriptSegment[];
  realtimePendingDelta: string;
  realtimePendingSpeakerLabel?: string | null;
  vadSegments: LiveTranscriptSegment[];
  // Whisper coach
  whisper: VadWhisperView | null;
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

export function MeetingCoachLayout({
  captureMode,
  capturing,
  vadConfig,
  onUpdateVadConfig,
  isRealtimeSessionActive,
  realtimeSegments,
  realtimePendingDelta,
  realtimePendingSpeakerLabel,
  vadSegments,
  whisper,
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
  const setupDisabled = capturing;
  const prepDefaultOpen = !capturing;
  const captureUserMic = shouldCaptureUserMic(vadConfig);
  const showMicToggle =
    captureMode === "vad" ||
    (captureMode === "realtime" && !vadConfig.realtime_speaker_labels);

  const micCaptureToggle = showMicToggle ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/80 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Capture your microphone</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {captureUserMic
            ? "Your mic is labeled User and sent to the coach."
            : "Only meeting audio (Client) is captured."}
        </p>
      </div>
      <Switch
        checked={captureUserMic}
        onCheckedChange={(checked) =>
          onUpdateVadConfig({
            ...vadConfig,
            capture_user_mic: checked,
          })
        }
      />
    </div>
  ) : null;

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
      <LiveTranscript
        segments={vadSegments}
        pendingDelta=""
        isSessionActive={capturing}
        isCapturing={capturing}
        showSpeakerLabels
        displayMode="caption"
        minimal
        title="Live transcript"
      />
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
      <div className="space-y-3">
        {micCaptureToggle}
        {liveAudioBody}
      </div>

      {coachPanel}

      {meetingPrep}
    </div>
  );
}
