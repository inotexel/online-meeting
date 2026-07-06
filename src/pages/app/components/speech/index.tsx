import { useState, useCallback, useEffect } from "react";
import {
  Button,
  Popover,
  PopoverTrigger,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  AudioLinesIcon,
  CameraIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ModeSwitcher } from "./ModeSwitcher";
import { RecordingPanel } from "./RecordingPanel";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { PermissionFlow } from "./PermissionFlow";
import { QuickActions } from "./QuickActions";
import { Warning } from "./Warning";
import { MeetingCoachLayout } from "./MeetingCoachLayout";
import { OverlaySizeToggle } from "./OverlaySizeToggle";
import { OverlayAskSection } from "./OverlayAskSection";
import { useSystemAudioType, getCaptureMode, useGoogleCalendar } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    isPopoverOpen,
    setIsPopoverOpen,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation,
    conversation,
    resizeWindow,
    overlaySizeMode,
    applyOverlaySizeMode,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    isRealtimeMode,
    isRealtimeSessionActive,
    realtimeSegments,
    realtimePendingDelta,
    realtimePendingSpeakerLabel,
    vadSegments,
    meetingClientName,
    setMeetingClientName,
    openaiApiKey,
    knowledgeConfigured,
    knowledgeStatus,
    clientGraphContext,
    isMemorySyncing,
    memorySyncError,
    coachBlockedReason,
    testKnowledgeConnection,
    sybillApiKey,
    setSybillApiKey,
    sybillSyncing,
    sybillStatus,
    sybillResult,
    sybillCard,
    knownClients,
    runSybillSync,
    cancelSybillSync,
    vadWhisper,
    vadWhisperCoachStatus,
    vadWhisperCoachLastError,
    vadWhisperCoachBlockedReason,
    vadWhisperIsThinking,
    vadWhisperMeetingStage,
    meetingAskActive,
    streamMeetingAskQuestion,
  } = props;

  const { hasActiveLicense, supportsImages } = useApp();

  // View mode toggle
  const [conversationMode, setConversationMode] = useState(false);

  // Screenshot state
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  const captureMode = getCaptureMode(vadConfig);
  const isVadMode = captureMode === "vad";
  const hasResponse =
    !isRealtimeMode && !isVadMode && (lastAIResponse || isAIProcessing);

  const googleCalendar = useGoogleCalendar(
    (captureMode === "realtime" || captureMode === "vad") && knowledgeConfigured
  );

  const isMeetingCoachMode = captureMode === "realtime" || captureMode === "vad";
  const whisperBlockedReason =
    vadWhisperCoachBlockedReason ?? coachBlockedReason ?? undefined;

  // Keyboard shortcut for Cmd+K to toggle view mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      // Cmd+K or Ctrl+K to toggle view mode
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setConversationMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  // Reset screenshot when processing starts (message is being sent)
  useEffect(() => {
    if (isProcessing && screenshotImage) {
      setScreenshotImage(null);
    }
  }, [isProcessing, screenshotImage]);

  const handleToggleCapture = async () => {
    if (capturing) {
      await stopCapture();
    } else {
      await startCapture();
    }
  };

  const handleHeadphonesClick = async () => {
    if (capturing) {
      await stopCapture();
    }
  };

  const handleModeChange = (mode: typeof captureMode) => {
    updateVadConfiguration({
      ...vadConfig,
      capture_mode: mode,
      enabled: mode === "vad",
    });
  };

  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Capture screenshot
      const base64: string = await invoke("capture_screenshot", {
        screenId: null, // Use default screen
      });

      setScreenshotImage(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot]);

  const handleRemoveScreenshot = useCallback(() => {
    setScreenshotImage(null);
  }, []);

  const getButtonIcon = () => {
    if (setupRequired) return <AlertCircleIcon className="text-orange-500" />;
    if (error && !setupRequired)
      return <AlertCircleIcon className="text-red-500" />;
    if (isProcessing) return <LoaderIcon className="animate-spin" />;
    if (capturing)
      return <AudioLinesIcon className="text-green-500 animate-pulse" />;
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup required - Click for instructions";
    if (error && !setupRequired) return `Error: ${error}`;
    if (isProcessing) return "Transcribing audio...";
    if (capturing) return "Stop system audio capture";
    return "Open system audio panel";
  };

  const expandedOriginalHeight = isMeetingCoachMode
    ? capturing
      ? 720
      : 500
    : capturing
      ? 600
      : 480;

  const meetingAsk = {
    active: Boolean(meetingAskActive),
    streamAsk: streamMeetingAskQuestion,
  };

  const speechPanelLayout = useCallback(
    () => ({
      sizeMode: overlaySizeMode,
      originalHeight: expandedOriginalHeight,
    }),
    [overlaySizeMode, expandedOriginalHeight]
  );

  const setSpeechPanelOpen = useCallback(
    (open: boolean) => {
      if (capturing && !open) {
        return;
      }
      if (open) {
        document.body.dataset.pluelySpeechPanelOpen = "true";
      } else {
        delete document.body.dataset.pluelySpeechPanelOpen;
      }
      setIsPopoverOpen(open);
      void resizeWindow(open, open ? speechPanelLayout() : undefined);
    },
    [capturing, resizeWindow, setIsPopoverOpen, speechPanelLayout]
  );

  useEffect(() => {
    if (!isPopoverOpen) return;
    void resizeWindow(true, speechPanelLayout());
  }, [capturing, isPopoverOpen, resizeWindow, speechPanelLayout]);

  useEffect(() => {
    if (isPopoverOpen) {
      document.body.dataset.pluelySpeechPanelOpen = "true";
    } else {
      delete document.body.dataset.pluelySpeechPanelOpen;
    }
    return () => {
      delete document.body.dataset.pluelySpeechPanelOpen;
    };
  }, [isPopoverOpen]);

  return (
    <>
    <Popover
      open={isPopoverOpen}
      onOpenChange={setSpeechPanelOpen}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleHeadphonesClick}
          className={cn(
            capturing && "bg-green-50 hover:bg-green-100",
            error && "bg-red-100 hover:bg-red-200"
          )}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>
    </Popover>

    {isPopoverOpen && (
      <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-background">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header - Mode Switcher + Actions */}
            <div className="flex-shrink-0 select-none border-b border-border/50 p-3">
              <div className="flex items-center justify-between gap-2">
                {/* Mode Switcher */}
                {!setupRequired && (
                  <ModeSwitcher
                    captureMode={captureMode}
                    onModeChange={handleModeChange}
                    disabled={
                      isRecordingInContinuousMode ||
                      isProcessing ||
                      isAIProcessing ||
                      isRealtimeSessionActive
                    }
                  />
                )}
                {setupRequired && (
                  <h2 className="font-semibold text-sm">Setup Required</h2>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <OverlaySizeToggle
                    value={overlaySizeMode}
                    onChange={(mode) =>
                      void applyOverlaySizeMode(mode, expandedOriginalHeight)
                    }
                  />

                  {!setupRequired && !capturing && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleToggleCapture}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Start listening to system audio"
                    >
                      <HeadphonesIcon className="w-3 h-3" />
                      Start
                    </Button>
                  )}

                  {!setupRequired && capturing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleToggleCapture}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Stop system audio capture"
                    >
                      Stop
                    </Button>
                  )}

                  {/* Screenshot — manual mode only */}
                  {hasActiveLicense &&
                    !setupRequired &&
                    supportsImages &&
                    captureMode === "continuous" && (
                    <Button
                      size="sm"
                      variant={screenshotImage ? "default" : "outline"}
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot}
                      className={cn(
                        "h-6 text-[10px] gap-1 px-2",
                        screenshotImage && "bg-primary text-primary-foreground"
                      )}
                      title="Capture screenshot to include with transcription"
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                      Screenshot
                    </Button>
                  )}

                  {/* New conversation — manual AI chat only */}
                  {!setupRequired && captureMode === "continuous" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {/* Close Button */}
                  {!capturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Close"
                      onClick={() => {
                        setSpeechPanelOpen(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Ask — pinned below header so it's always visible */}
            {!setupRequired && (
              <div className="flex-shrink-0 border-b border-border/50 px-3 py-2.5">
                <OverlayAskSection meetingAsk={meetingAsk} />
              </div>
            )}

            <div
              ref={scrollAreaRef}
              data-slot="scroll-area-viewport"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="space-y-2 p-3">
                {/* Screenshot Preview */}
                {screenshotImage && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <img
                      src={`data:image/png;base64,${screenshotImage}`}
                      alt="Screenshot"
                      className="h-12 w-20 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium">
                        Screenshot attached
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        Will be sent with next transcription
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={handleRemoveScreenshot}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Error Display */}
                {error && !setupRequired && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium text-red-800">
                        Error
                      </p>
                      <p className="text-[10px] text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {/* Setup Required - Permission Flow */}
                {setupRequired ? (
                  <PermissionFlow
                    onPermissionGranted={() => {
                      startCapture();
                    }}
                    onPermissionDenied={() => {
                      // Keep showing setup instructions
                    }}
                  />
                ) : (
                  <>
                    {/* Recording Panel (manual mode only) */}
                    {captureMode === "continuous" && (
                      <RecordingPanel
                        isVadMode={false}
                        isRecording={isRecordingInContinuousMode}
                        isProcessing={isProcessing}
                        isAIProcessing={isAIProcessing}
                        recordingProgress={recordingProgress}
                        maxDuration={vadConfig.max_recording_duration_secs}
                        onStartRecording={startContinuousRecording}
                        onStopAndSend={manualStopAndSend}
                        onIgnore={ignoreContinuousRecording}
                      />
                    )}

                    {isMeetingCoachMode && (
                      <MeetingCoachLayout
                        captureMode={captureMode as "vad" | "realtime"}
                        capturing={capturing}
                        vadConfig={vadConfig}
                        onUpdateVadConfig={updateVadConfiguration}
                        isRealtimeSessionActive={isRealtimeSessionActive}
                        realtimeSegments={realtimeSegments}
                        realtimePendingDelta={realtimePendingDelta}
                        realtimePendingSpeakerLabel={realtimePendingSpeakerLabel}
                        vadSegments={vadSegments}
                        whisper={vadWhisper}
                        meetingStage={vadWhisperMeetingStage}
                        isThinking={vadWhisperIsThinking}
                        isMemorySyncing={isMemorySyncing}
                        whisperBlockedReason={whisperBlockedReason}
                        whisperStatus={vadWhisperCoachStatus}
                        whisperError={
                          vadWhisperCoachLastError || memorySyncError
                        }
                        meetingClientName={meetingClientName}
                        onClientNameChange={setMeetingClientName}
                        knowledgeConfigured={knowledgeConfigured}
                        knowledgeStatus={knowledgeStatus}
                        clientGraphContext={clientGraphContext}
                        knownClients={knownClients}
                        onTestConnection={testKnowledgeConnection}
                        openaiApiKey={openaiApiKey}
                        sybillApiKey={sybillApiKey}
                        onSybillApiKeyChange={setSybillApiKey}
                        sybillSyncing={sybillSyncing}
                        sybillStatus={sybillStatus}
                        sybillResult={sybillResult}
                        sybillCard={sybillCard}
                        onSybillSync={runSybillSync}
                        onSybillCancel={cancelSybillSync}
                        calendarConfigured={googleCalendar.configured}
                        calendarConnected={googleCalendar.connected}
                        calendarMeetings={googleCalendar.meetings}
                        calendarLoading={googleCalendar.loading}
                        calendarConnecting={googleCalendar.connecting}
                        calendarError={googleCalendar.error}
                        onCalendarConnect={() => void googleCalendar.connect()}
                        onCalendarDisconnect={() =>
                          void googleCalendar.disconnect()
                        }
                        onCalendarRefresh={() =>
                          void googleCalendar.refreshMeetings()
                        }
                        onSelectCalendarMeeting={setMeetingClientName}
                      />
                    )}

                    {/* AI Response (manual mode only) */}
                    {!isRealtimeMode && !isVadMode && (
                      <ResultsSection
                        lastTranscription={lastTranscription}
                        lastAIResponse={lastAIResponse}
                        isAIProcessing={isAIProcessing}
                        conversation={conversation}
                        conversationMode={conversationMode}
                        setConversationMode={setConversationMode}
                      />
                    )}

                    {captureMode === "continuous" && (
                      <>
                        <SettingsPanel
                          vadConfig={vadConfig}
                          onUpdateVadConfig={updateVadConfiguration}
                          useSystemPrompt={useSystemPrompt}
                          setUseSystemPrompt={setUseSystemPrompt}
                          contextContent={contextContent}
                          setContextContent={setContextContent}
                          captureMode={captureMode}
                        />
                        <Warning captureMode={captureMode} />
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            {!setupRequired && hasResponse && (
              <div className="flex-shrink-0 border-t border-border/50 p-2">
                <QuickActions
                  actions={quickActions}
                  onActionClick={handleQuickActionClick}
                  onAddAction={addQuickAction}
                  onRemoveAction={removeQuickAction}
                  isManaging={isManagingQuickActions}
                  setIsManaging={setIsManagingQuickActions}
                  show={showQuickActions}
                  setShow={setShowQuickActions}
                />
              </div>
            )}

          </div>
      </div>
    )}
    </>
  );
};
