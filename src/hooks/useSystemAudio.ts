import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
import {
  safeLocalStorage,
  shouldUsePluelyAPI,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
} from "@/lib";
import {
  createRealtimeSession,
  endRealtimeSession,
  saveRealtimeTranscriptSegment,
} from "@/lib/database";
import { Message } from "@/types/completion";
import { TYPE_PROVIDER } from "@/types/provider.type";
import { useMeetingMemory } from "./useMeetingMemory";
import { formatDialogueLine } from "@/lib/memory/dialogue";

export type CaptureMode = "vad" | "continuous" | "realtime";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  capture_mode?: CaptureMode | null;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
  realtime_model?: string | null;
  realtime_language?: string | null;
  realtime_speaker_labels?: boolean | null;
  realtime_max_speakers?: number | null;
  realtime_assemblyai_model?: string | null;
  assemblyai_api_key?: string | null;
}

// OPTIMIZED VAD defaults - matches backend exactly for perfect performance
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012, // Much less sensitive - only real speech
  peak_threshold: 0.035, // Higher threshold - filters clicks/noise
  silence_chunks: 45, // ~1.0s of required silence
  min_speech_chunks: 7, // ~0.16s - captures short answers
  pre_speech_chunks: 12, // ~0.27s - enough to catch word start
  noise_gate_threshold: 0.003, // Stronger noise filtering
  max_recording_duration_secs: 180, // 3 minutes default
  realtime_model: "gpt-realtime-whisper",
  realtime_language: "en",
  realtime_speaker_labels: false,
  realtime_max_speakers: 5,
  realtime_assemblyai_model: "universal-streaming-english",
  assemblyai_api_key: "",
};

export function getCaptureMode(config: VadConfig): CaptureMode {
  if (config.capture_mode) {
    return config.capture_mode;
  }
  return config.enabled ? "vad" : "continuous";
}

function getSttApiKey(variables: Record<string, string>): string {
  for (const [key, value] of Object.entries(variables)) {
    if (
      key.toUpperCase().includes("API_KEY") ||
      key.toLowerCase() === "api_key"
    ) {
      return value?.trim() ?? "";
    }
  }
  return "";
}

function isAssemblyAiProvider(provider: TYPE_PROVIDER): boolean {
  const curl = provider.curl?.toLowerCase() ?? "";
  const id = provider.id?.toLowerCase() ?? "";
  return curl.includes("assemblyai.com") || id.includes("assemblyai");
}

function getAssemblyAiApiKey(
  config: VadConfig,
  providerId: string | undefined,
  variables: Record<string, string>,
  allProviders: TYPE_PROVIDER[]
): string {
  if (config.assemblyai_api_key?.trim()) {
    return config.assemblyai_api_key.trim();
  }

  const selected = allProviders.find((p) => p.id === providerId);
  if (selected && isAssemblyAiProvider(selected)) {
    return getSttApiKey(variables);
  }

  return "";
}

function buildRealtimeProviderConfigs(
  config: VadConfig,
  providerId: string | undefined,
  variables: Record<string, string>,
  allProviders: TYPE_PROVIDER[]
) {
  if (config.realtime_speaker_labels) {
    return {
      assemblyaiConfig: {
        apiKey: getAssemblyAiApiKey(config, providerId, variables, allProviders),
        speechModel:
          config.realtime_assemblyai_model || "universal-streaming-english",
        maxSpeakers: config.realtime_max_speakers || 5,
      },
    };
  }

  return {
    realtimeConfig: {
      provider: "openai",
      apiKey: getSttApiKey(variables),
      model: config.realtime_model || "gpt-realtime-whisper",
      language: config.realtime_language || "en",
    },
  };
}

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow, overlaySizeMode, applyOverlaySizeMode } =
    useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0); // For continuous mode
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);
  const [isRealtimeMode, setIsRealtimeMode] = useState<boolean>(false);
  const [isRealtimeSessionActive, setIsRealtimeSessionActive] =
    useState<boolean>(false);
  const [realtimeSegments, setRealtimeSegments] = useState<
    { id: string; text: string; isFinal: boolean; speakerLabel?: string | null }[]
  >([]);
  const [realtimePendingDelta, setRealtimePendingDelta] = useState("");
  const [realtimePendingSpeakerLabel, setRealtimePendingSpeakerLabel] =
    useState<string | null>(null);
  const realtimeSessionIdRef = useRef<string>("");
  const realtimeSequenceRef = useRef(0);
  const realtimeFinalItemIdsRef = useRef<Set<string>>(new Set());
  const realtimePendingByItemRef = useRef<
    Record<string, { text: string; speakerLabel?: string | null }>
  >({});
  const captureModeRef = useRef<CaptureMode>(getCaptureMode(DEFAULT_VAD_CONFIG));
  const realtimeSpeakerLabelsRef = useRef<boolean>(
    DEFAULT_VAD_CONFIG.realtime_speaker_labels ?? false
  );
  const isRestartingCaptureRef = useRef(false);
  const isStoppingCaptureRef = useRef(false);
  const lastRealtimeActivityRef = useRef(Date.now());
  const capturingRef = useRef(false);

  const touchRealtimeActivity = useCallback(() => {
    lastRealtimeActivityRef.current = Date.now();
  }, []);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
  } = useApp();

  const aiProvider = allAiProviders.find(
    (p) => p.id === selectedAIProvider.provider
  );
  const meetingMemory = useMeetingMemory({
    provider: aiProvider,
    selectedProvider: selectedAIProvider,
    openaiApiKey: getSttApiKey(selectedSttProvider.variables),
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const SCROLL_BOTTOM_THRESHOLD_PX = 72;

  const getOverlayScrollViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector(
      "[data-slot='scroll-area-viewport']"
    ) as HTMLElement | null;
  }, []);

  const isOverlayNearBottom = useCallback((element: HTMLElement) => {
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    return distance <= SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollOverlayToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (!stickToBottomRef.current) return;
      const scrollElement = getOverlayScrollViewport();
      if (!scrollElement) return;
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior });
    },
    [getOverlayScrollViewport]
  );

  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
        captureModeRef.current = getCaptureMode(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Handle continuous recording progress events AND error events
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Progress updates (every second)
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        // Recording started
        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        // Recording stopped
        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          // Don't show error - this is expected behavior
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  const syncRealtimePendingDelta = useCallback(() => {
    const entries = Object.values(realtimePendingByItemRef.current);
    const latestEntry = [...entries].reverse().find((entry) => entry.text.trim());
    setRealtimePendingDelta(latestEntry?.text.trim() ?? "");
    setRealtimePendingSpeakerLabel(latestEntry?.speakerLabel ?? null);
  }, []);

  const clearRealtimePending = useCallback(() => {
    realtimePendingByItemRef.current = {};
    setRealtimePendingDelta("");
    setRealtimePendingSpeakerLabel(null);
  }, []);

  // Realtime transcription event listeners
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const registerListener = async (
      event: string,
      handler: Parameters<typeof listen>[1]
    ) => {
      const unlisten = await listen(event, handler);
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    const setupRealtimeListeners = async () => {
      try {
        await registerListener("transcript-delta", (event) => {
          const payload = event.payload as {
            delta: string;
            itemId?: string;
            replace?: boolean;
            speakerLabel?: string;
          };
          if (!payload.delta) return;

          touchRealtimeActivity();

          const itemKey =
            payload.itemId ??
            `${payload.speakerLabel ?? "unknown"}_default`;
          const current = realtimePendingByItemRef.current[itemKey] ?? {
            text: "",
          };
          realtimePendingByItemRef.current[itemKey] = {
            text: payload.replace
              ? payload.delta
              : `${current.text}${payload.delta}`,
            speakerLabel: payload.speakerLabel ?? current.speakerLabel ?? null,
          };
          syncRealtimePendingDelta();
        });

        await registerListener("transcript-final", async (event) => {
          const payload = event.payload as {
            transcript: string;
            itemId?: string;
            speakerLabel?: string;
          };
          const text = payload.transcript?.trim();
          if (!text) return;

          touchRealtimeActivity();

          if (payload.itemId) {
            if (realtimeFinalItemIdsRef.current.has(payload.itemId)) return;
            realtimeFinalItemIdsRef.current.add(payload.itemId);
          }

          const itemKey =
            payload.itemId ??
            `${payload.speakerLabel ?? "unknown"}_default`;
          delete realtimePendingByItemRef.current[itemKey];
          syncRealtimePendingDelta();

          const sessionId = realtimeSessionIdRef.current;
          const segmentId = `rtseg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const sequenceNum = realtimeSequenceRef.current++;

          setRealtimeSegments((prev) => {
            if (
              payload.itemId &&
              prev.some((segment) => segment.id === payload.itemId)
            ) {
              return prev;
            }
            return [
              ...prev,
              {
                id: payload.itemId ?? segmentId,
                text,
                isFinal: true,
                speakerLabel: payload.speakerLabel ?? null,
              },
            ];
          });
          setLastTranscription(text);

          if (sessionId) {
            try {
              await saveRealtimeTranscriptSegment({
                id: segmentId,
                sessionId,
                text,
                isFinal: true,
                itemId: payload.itemId ?? null,
                sequenceNum,
                speakerLabel: payload.speakerLabel ?? null,
              });
            } catch (err) {
              console.error("Failed to save realtime segment:", err);
            }
          }

          void meetingMemory.appendUtterance({
            utteranceId: payload.itemId ?? segmentId,
            text,
            speakerLabel: payload.speakerLabel ?? null,
            sequenceNum,
          });
        });

        await registerListener("transcript-speaker-revision", (event) => {
          const payload = event.payload as {
            turnOrder: number;
            speakerLabel?: string | null;
            transcript?: string | null;
          };
          const itemId = `turn_${payload.turnOrder}`;

          setRealtimeSegments((prev) =>
            prev.map((segment) =>
              segment.id === itemId
                ? {
                    ...segment,
                    speakerLabel:
                      payload.speakerLabel ?? segment.speakerLabel ?? null,
                    text: payload.transcript?.trim() || segment.text,
                  }
                : segment
            )
          );
        });

        await registerListener("realtime-session-started", () => {
          realtimeFinalItemIdsRef.current.clear();
          touchRealtimeActivity();
          setIsRealtimeSessionActive(true);
          setError((prev) =>
            prev?.includes("Reconnecting") ? "" : prev
          );
        });

        await registerListener("realtime-session-reconnecting", () => {
          setIsRealtimeSessionActive(false);
          clearRealtimePending();
          setError(
            "Reconnecting to transcription service…"
          );
        });

        await registerListener("realtime-session-stopped", async () => {
          setIsRealtimeSessionActive(false);
          const sessionId = realtimeSessionIdRef.current;
          if (sessionId) {
            try {
              await endRealtimeSession(sessionId);
            } catch (err) {
              console.error("Failed to end realtime session:", err);
            }
          }
        });

        await registerListener("realtime-transcription-error", (event) => {
          const message = event.payload as string;
          setError(message || "Realtime transcription error");
          setIsRealtimeSessionActive(false);
          setCapturing(false);
        });
      } catch (err) {
        console.error("Failed to setup realtime listeners:", err);
      }
    };

    setupRealtimeListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    syncRealtimePendingDelta,
    meetingMemory.appendUtterance,
    touchRealtimeActivity,
    clearRealtimePending,
  ]);

  // Keep UI in sync when Rust ends capture (WS drop, audio error, etc.)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen("capture-stopped", () => {
        if (!capturingRef.current) return;
        if (isRestartingCaptureRef.current) return;

        const mode = captureModeRef.current;
        setCapturing(false);
        setIsRealtimeSessionActive(false);
        setIsRecordingInContinuousMode(false);

        if (mode === "realtime") {
          clearRealtimePending();
          if (!isStoppingCaptureRef.current && realtimeSessionIdRef.current) {
            setError(
              (prev) =>
                prev ||
                "Realtime capture ended unexpectedly. Press Start to try again."
            );
            void meetingMemory.endGraphMeeting();
          }
        }

        isStoppingCaptureRef.current = false;
      });
    };

    void setup();
    return () => {
      unlisten?.();
    };
  }, [clearRealtimePending, meetingMemory.endGraphMeeting]);

  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  // Handle single speech detection event (VAD and continuous modes only)
  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;

    const setupEventListener = async () => {
      try {
        speechUnlisten = await listen("speech-detected", async (event) => {
          try {
            if (!capturing) return;
            if (getCaptureMode(vadConfig) === "realtime") return;

            const base64Audio = event.payload as string;
            // Convert to blob
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });

            const usePluelyAPI = await shouldUsePluelyAPI();
            if (!selectedSttProvider.provider && !usePluelyAPI) {
              setError("No speech provider selected.");
              return;
            }

            const providerConfig = allSttProviders.find(
              (p) => p.id === selectedSttProvider.provider
            );

            if (!providerConfig && !usePluelyAPI) {
              setError("Speech provider config not found.");
              return;
            }

            setIsProcessing(true);

            // Add timeout wrapper for STT request (30 seconds)
            const sttPromise = fetchSTT({
              provider: providerConfig,
              selectedProvider: selectedSttProvider,
              audio: audioBlob,
            });

            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(
                () => reject(new Error("Speech transcription timed out (30s)")),
                30000
              );
            });

            try {
              const transcription = await Promise.race([
                sttPromise,
                timeoutPromise,
              ]);

              if (transcription.trim()) {
                setLastTranscription(transcription);
                setError("");

                const effectiveSystemPrompt = useSystemPrompt
                  ? systemPrompt || DEFAULT_SYSTEM_PROMPT
                  : contextContent || DEFAULT_SYSTEM_PROMPT;

                const previousMessages = conversation.messages.map((msg) => {
                  return { role: msg.role, content: msg.content };
                });

                await processWithAI(
                  transcription,
                  effectiveSystemPrompt,
                  previousMessages
                );
              } else {
                setError("Received empty transcription");
              }
            } catch (sttError: any) {
              console.error("STT Error:", sttError);
              setError(sttError.message || "Failed to transcribe audio");
              setIsPopoverOpen(true);
            }
          } catch (err) {
            setError("Failed to process speech");
          } finally {
            setIsProcessing(false);
          }
        });
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      if (speechUnlisten) speechUnlisten();
    };
  }, [
    capturing,
    selectedSttProvider,
    allSttProviders,
    conversation.messages.length,
    vadConfig,
  ]);

  const buildCaptureInvokeArgs = useCallback(
    (config: VadConfig) => {
      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const inputDeviceId =
        selectedAudioDevices.input.id !== "default"
          ? selectedAudioDevices.input.id
          : null;

      const mode = getCaptureMode(config);
      const args: Record<string, unknown> = {
        vadConfig: config,
        deviceId,
        inputDeviceId,
      };

      if (mode === "realtime") {
        const providerConfigs = buildRealtimeProviderConfigs(
          config,
          selectedSttProvider.provider,
          selectedSttProvider.variables,
          allSttProviders
        );
        Object.assign(args, providerConfigs);
      }

      return { args, deviceId, mode };
    },
    [
      selectedAudioDevices.output.id,
      selectedAudioDevices.input.id,
      selectedSttProvider.provider,
      selectedSttProvider.variables,
      allSttProviders,
    ]
  );

  // Context management functions
  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const effectiveSystemPrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    // Include the most recent transcription in conversation history if it exists
    let updatedMessages = [...conversation.messages];

    if (lastTranscription && lastTranscription.trim()) {
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      // Only add if it's not already the last message
      if (!lastMessage || lastMessage.content !== lastTranscription) {
        const timestamp = Date.now();
        const userMessage = {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: lastTranscription,
          timestamp,
        };
        updatedMessages.push(userMessage);

        // Update conversation state with the latest transcription
        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastTranscription),
        }));
      }
    }

    const previousMessages = updatedMessages.map((msg) => {
      return { role: msg.role, content: msg.content };
    });

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  // Start continuous recording manually
  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig,
        deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  const startRealtimeCapture = useCallback(async () => {
    setError("");
    const providerConfigs = buildRealtimeProviderConfigs(
      vadConfig,
      selectedSttProvider.provider,
      selectedSttProvider.variables,
      allSttProviders
    );

    if (vadConfig.realtime_speaker_labels) {
      if (!providerConfigs.assemblyaiConfig?.apiKey) {
        setError(
          "AssemblyAI API key required. Add it below or configure an AssemblyAI STT provider in Dev Space."
        );
        throw new Error("AssemblyAI API key required");
      }
    } else if (!providerConfigs.realtimeConfig?.apiKey) {
      setError(
        "OpenAI API key required. Configure it in Dev Space → STT provider."
      );
      throw new Error("OpenAI API key required");
    }

    const sessionId = `realtime_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    realtimeSessionIdRef.current = sessionId;
    realtimeSequenceRef.current = 0;
    realtimeFinalItemIdsRef.current.clear();
    lastRealtimeActivityRef.current = Date.now();
    setRealtimeSegments([]);
    clearRealtimePending();

    const deviceId =
      selectedAudioDevices.output.id !== "default"
        ? selectedAudioDevices.output.id
        : null;

    const inputDeviceId =
      selectedAudioDevices.input.id !== "default"
        ? selectedAudioDevices.input.id
        : null;

    await createRealtimeSession(sessionId, deviceId);
    await meetingMemory.refreshKnowledgeConfigured();
    await meetingMemory.startGraphMeeting(sessionId);

    // Clear any orphaned capture task from a prior failed session
    isRestartingCaptureRef.current = true;
    try {
      await invoke("stop_system_audio_capture");
    } catch {
      // No active capture — expected on first start
    } finally {
      isRestartingCaptureRef.current = false;
    }

    await invoke<string>("start_system_audio_capture", {
      vadConfig,
      deviceId,
      inputDeviceId,
      ...providerConfigs,
    });
  }, [
    vadConfig,
    selectedAudioDevices.output.id,
    selectedAudioDevices.input.id,
    selectedSttProvider.provider,
    selectedSttProvider.variables,
    allSttProviders,
    clearRealtimePending,
    meetingMemory,
  ]);

  const restartCaptureForMode = useCallback(
    async (config: VadConfig) => {
      if (isRestartingCaptureRef.current) return;
      isRestartingCaptureRef.current = true;

      try {
        const mode = getCaptureMode(config);
        setIsContinuousMode(mode === "continuous");
        setIsRealtimeMode(mode === "realtime");
        setIsRealtimeSessionActive(false);
        realtimeFinalItemIdsRef.current.clear();
        setRealtimeSegments([]);
        clearRealtimePending();
        setIsRecordingInContinuousMode(false);
        setRecordingProgress(0);
        setError("");

        await invoke("stop_system_audio_capture");

        if (mode === "realtime") {
          await startRealtimeCapture();
        } else if (mode === "vad") {
          const { args } = buildCaptureInvokeArgs(config);
          await invoke<string>("start_system_audio_capture", args);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Failed to switch mode: ${errorMessage}`);
        setCapturing(false);
        setIsRealtimeMode(false);
        setIsContinuousMode(false);
      } finally {
        isRestartingCaptureRef.current = false;
      }
    },
    [buildCaptureInvokeArgs, startRealtimeCapture, clearRealtimePending]
  );

  // Ignore current recording (stop without transcription)
  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      // Stop the capture without processing
      await invoke<string>("stop_system_audio_capture");

      // Reset states
      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[]
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!selectedAIProvider.provider && !usePluelyAPI) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          setError("AI provider config not found.");
          return;
        }

        try {
          for await (const chunk of fetchAIResponse({
            provider: usePluelyAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64: [],
          })) {
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
        }

        if (fullResponse) {
          const timestamp = Date.now();
          setConversation((prev) => ({
            ...prev,
            messages: [
              {
                id: generateMessageId("user", timestamp),
                role: "user" as const,
                content: transcription,
                timestamp,
              },
              {
                id: generateMessageId("assistant", timestamp + 1),
                role: "assistant" as const,
                content: fullResponse,
                timestamp: timestamp + 1,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }));
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        setIsAIProcessing(false);
        // No auto-restart - user manually controls when to start next recording
      }
    },
    [selectedAIProvider, allAiProviders, conversation.messages]
  );

  const startCapture = useCallback(async () => {
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const mode = getCaptureMode(vadConfig);
      captureModeRef.current = mode;
      const isContinuous = mode === "continuous";
      const isRealtime = mode === "realtime";

      if (isRealtime) {
        const apiKey = getSttApiKey(selectedSttProvider.variables);
        if (!apiKey) {
          setError(
            "OpenAI API key required. Configure it in Dev Space → STT provider."
          );
          setIsPopoverOpen(true);
          return;
        }
      }

      // Set up conversation
      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });

      setCapturing(true);
      setIsPopoverOpen(true);
      void resizeWindow(true, {
        originalHeight: isRealtime ? 680 : 600,
      });
      setIsContinuousMode(isContinuous);
      setIsRealtimeMode(isRealtime);
      setRecordingProgress(0);
      setRealtimeSegments([]);
      setRealtimePendingDelta("");

      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      if (isRealtime) {
        try {
          await startRealtimeCapture();
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          setCapturing(false);
          setIsRealtimeMode(false);
        }
        return;
      }

      // VAD mode: Start recording immediately
      await invoke<string>("stop_system_audio_capture");

      const { args } = buildCaptureInvokeArgs(vadConfig);
      await invoke<string>("start_system_audio_capture", args);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [
    vadConfig,
    selectedSttProvider.variables,
    buildCaptureInvokeArgs,
    startRealtimeCapture,
    resizeWindow,
  ]);

  const stopCapture = useCallback(async () => {
    try {
      isStoppingCaptureRef.current = true;

      // Abort any ongoing AI requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Stop the audio capture
      await invoke<string>("stop_system_audio_capture");

      await meetingMemory.endGraphMeeting();

      // Reset ALL states
      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRealtimeMode(false);
      setIsRealtimeSessionActive(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      realtimeFinalItemIdsRef.current.clear();
      setRealtimeSegments([]);
      clearRealtimePending();
      realtimeSessionIdRef.current = "";
      setLastTranscription("");
      setLastAIResponse("");
      setError("");
      setIsPopoverOpen(false);
      isStoppingCaptureRef.current = false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
      isStoppingCaptureRef.current = false;
    }
  }, [clearRealtimePending, meetingMemory]);

  // Detect stalled transcription while UI still shows Stop
  useEffect(() => {
    if (!capturing || !isRealtimeMode || !isRealtimeSessionActive) return;

    const interval = window.setInterval(() => {
      const idleMs = Date.now() - lastRealtimeActivityRef.current;
      if (idleMs < 45_000) return;

      void invoke<boolean>("get_capture_status")
        .then((stillCapturing) => {
          if (!stillCapturing) {
            setCapturing(false);
            setIsRealtimeSessionActive(false);
            setError(
              (prev) =>
                prev ||
                "Transcription stopped but capture was still active. Press Start again."
            );
            return;
          }

          setError(
            "No new transcription for 45s while audio is still playing. Try Stop → Start, or check system audio output."
          );
        })
        .catch(() => {
          // ignore status check failures
        });
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [capturing, isRealtimeMode, isRealtimeSessionActive]);

  // Keep live transcript snapshot in sync for the coach
  useEffect(() => {
    if (!isRealtimeSessionActive || !capturing) return;

    const parts = realtimeSegments.map((segment) =>
      formatDialogueLine(segment.speakerLabel, segment.text)
    );
    const pending = realtimePendingDelta.trim();
    const pendingLine = realtimePendingSpeakerLabel
      ? formatDialogueLine(realtimePendingSpeakerLabel, pending)
      : pending;
    meetingMemory.setLiveTranscriptSnapshot(
      [...parts, pendingLine].filter(Boolean).join("\n")
    );
  }, [
    isRealtimeSessionActive,
    capturing,
    realtimeSegments,
    realtimePendingDelta,
    realtimePendingSpeakerLabel,
    meetingMemory.setLiveTranscriptSnapshot,
  ]);

  // Periodic memory sync + live coaching during realtime capture
  const runCoachCycleRef = useRef(meetingMemory.runCoachCycle);
  runCoachCycleRef.current = meetingMemory.runCoachCycle;

  useEffect(() => {
    if (!isRealtimeSessionActive || !capturing) return;

    void runCoachCycleRef.current(true);

    const interval = window.setInterval(() => {
      void runCoachCycleRef.current();
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [isRealtimeSessionActive, capturing]);

  // Manual stop for continuous recording
  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      // Show processing state immediately
      setIsProcessing(true);

      // Trigger manual stop event
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false); // Clear processing state on error
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    if (capturing) {
      document.body.dataset.pluelyCapturing = "true";
    } else {
      delete document.body.dataset.pluelyCapturing;
    }
  }, [capturing]);

  useEffect(() => {
    const shouldAutoOpen =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    if (shouldAutoOpen) {
      setIsPopoverOpen(true);
      const expandedHeight = isRealtimeMode && capturing ? 680 : 600;
      void resizeWindow(true, { originalHeight: expandedHeight });
    }
  }, [
    capturing,
    isRealtimeMode,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  useEffect(() => {
    const mode = getCaptureMode(vadConfig);
    const prevMode = captureModeRef.current;
    captureModeRef.current = mode;

    if (!capturing) {
      captureModeRef.current = mode;
      setIsContinuousMode(mode === "continuous");
      setIsRealtimeMode(mode === "realtime");
      return;
    }

    setIsContinuousMode(mode === "continuous");
    setIsRealtimeMode(mode === "realtime");

    if (mode === "continuous") {
      setIsRecordingInContinuousMode(false);
    }

    if (prevMode !== mode) {
      restartCaptureForMode(vadConfig);
      return;
    }

    const speakerLabelsChanged =
      realtimeSpeakerLabelsRef.current !==
      Boolean(vadConfig.realtime_speaker_labels);
    realtimeSpeakerLabelsRef.current = Boolean(
      vadConfig.realtime_speaker_labels
    );

    if (mode === "realtime" && speakerLabelsChanged) {
      restartCaptureForMode(vadConfig);
    }
  }, [vadConfig, capturing, restartCaptureForMode]);

  // Track manual scroll — only auto-scroll when user is already at the bottom
  useEffect(() => {
    if (!isPopoverOpen) return;

    let viewport: HTMLElement | null = null;
    const onScroll = () => {
      if (!viewport) return;
      stickToBottomRef.current = isOverlayNearBottom(viewport);
    };

    const attach = () => {
      viewport = getOverlayScrollViewport();
      if (!viewport) return false;
      viewport.addEventListener("scroll", onScroll, { passive: true });
      return true;
    };

    if (!attach()) {
      const frame = requestAnimationFrame(() => attach());
      return () => {
        cancelAnimationFrame(frame);
        viewport?.removeEventListener("scroll", onScroll);
      };
    }

    return () => viewport?.removeEventListener("scroll", onScroll);
  }, [isPopoverOpen, getOverlayScrollViewport, isOverlayNearBottom]);

  useEffect(() => {
    if (isPopoverOpen) {
      stickToBottomRef.current = true;
    }
  }, [isPopoverOpen]);

  useEffect(() => {
    scrollOverlayToBottom();
  }, [
    realtimeSegments,
    realtimePendingDelta,
    lastTranscription,
    lastAIResponse,
    conversation.messages.length,
    isAIProcessing,
    scrollOverlayToBottom,
  ]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = getOverlayScrollViewport();

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
        requestAnimationFrame(() => {
          if (isOverlayNearBottom(scrollElement)) {
            stickToBottomRef.current = true;
          }
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
        stickToBottomRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen, getOverlayScrollViewport, isOverlayNearBottom]);

  // Keyboard shortcuts for continuous mode recording (local shortcuts)
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      // Enter: Start recording (when not recording) or Stop & Send (when recording)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      // Escape: Ignore recording (when recording)
      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      // Space: Start recording (when not recording) - only if not typing in input
      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // AI processing
    processWithAI,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    startNewConversation,
    // Window resize
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
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Continuous recording
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    // Realtime transcription
    isRealtimeMode,
    isRealtimeSessionActive,
    realtimeSegments,
    realtimePendingDelta,
    realtimePendingSpeakerLabel,
    // Meeting memory + coach
    meetingClientName: meetingMemory.clientName,
    setMeetingClientName: meetingMemory.setClientName,
    meetingClientId: meetingMemory.clientId,
    openaiApiKey: getSttApiKey(selectedSttProvider.variables),
    knowledgeConfigured: meetingMemory.knowledgeConfigured,
    knowledgeStatus: meetingMemory.knowledgeStatus,
    clientGraphContext: meetingMemory.clientContext,
    coachSuggestions: meetingMemory.coachSuggestions,
    isMemorySyncing: meetingMemory.isMemorySyncing,
    coachStatus: meetingMemory.coachStatus,
    coachLastError: meetingMemory.coachLastError,
    coachBlockedReason: meetingMemory.coachBlockedReason,
    testKnowledgeConnection: meetingMemory.testConnection,
    refreshClientGraphContext: meetingMemory.refreshClientContext,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
  };
}
