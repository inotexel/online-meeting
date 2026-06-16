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
  const { resizeWindow } = useWindowResize();
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
    { id: string; text: string; isFinal: boolean }[]
  >([]);
  const [realtimePendingDelta, setRealtimePendingDelta] = useState("");
  const realtimeSessionIdRef = useRef<string>("");
  const realtimeSequenceRef = useRef(0);
  const realtimeFinalItemIdsRef = useRef<Set<string>>(new Set());
  const realtimePendingByItemRef = useRef<Record<string, string>>({});
  const captureModeRef = useRef<CaptureMode>(getCaptureMode(DEFAULT_VAD_CONFIG));
  const isRestartingCaptureRef = useRef(false);

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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
    const pending = Object.values(realtimePendingByItemRef.current)
      .filter(Boolean)
      .join(" ")
      .trim();
    setRealtimePendingDelta(pending);
  }, []);

  const clearRealtimePending = useCallback(() => {
    realtimePendingByItemRef.current = {};
    setRealtimePendingDelta("");
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
          const payload = event.payload as { delta: string; itemId?: string };
          if (!payload.delta) return;

          const itemKey = payload.itemId ?? "default";
          realtimePendingByItemRef.current[itemKey] =
            (realtimePendingByItemRef.current[itemKey] ?? "") + payload.delta;
          syncRealtimePendingDelta();
        });

        await registerListener("transcript-final", async (event) => {
          const payload = event.payload as {
            transcript: string;
            itemId?: string;
          };
          const text = payload.transcript?.trim();
          if (!text) return;

          if (payload.itemId) {
            if (realtimeFinalItemIdsRef.current.has(payload.itemId)) return;
            realtimeFinalItemIdsRef.current.add(payload.itemId);
          }

          const itemKey = payload.itemId ?? "default";
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
              });
            } catch (err) {
              console.error("Failed to save realtime segment:", err);
            }
          }
        });

        await registerListener("realtime-session-started", () => {
          realtimeFinalItemIdsRef.current.clear();
          setIsRealtimeSessionActive(true);
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
  }, [syncRealtimePendingDelta]);

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

      const mode = getCaptureMode(config);
      const args: Record<string, unknown> = {
        vadConfig: config,
        deviceId,
      };

      if (mode === "realtime") {
        const apiKey = getSttApiKey(selectedSttProvider.variables);
        args.realtimeConfig = {
          api_key: apiKey,
          model: config.realtime_model || "gpt-realtime-whisper",
          language: config.realtime_language || "en",
        };
      }

      return { args, deviceId, mode };
    },
    [selectedAudioDevices.output.id, selectedSttProvider.variables]
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
    const apiKey = getSttApiKey(selectedSttProvider.variables);
    if (!apiKey) {
      setError(
        "OpenAI API key required. Configure it in Dev Space → STT provider."
      );
      throw new Error("OpenAI API key required");
    }

    const sessionId = `realtime_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    realtimeSessionIdRef.current = sessionId;
    realtimeSequenceRef.current = 0;
    realtimeFinalItemIdsRef.current.clear();
    setRealtimeSegments([]);
    clearRealtimePending();

    const deviceId =
      selectedAudioDevices.output.id !== "default"
        ? selectedAudioDevices.output.id
        : null;

    await createRealtimeSession(sessionId, deviceId);

    await invoke<string>("start_system_audio_capture", {
      vadConfig,
      deviceId,
      realtimeConfig: {
        api_key: apiKey,
        model: vadConfig.realtime_model || "gpt-realtime-whisper",
        language: vadConfig.realtime_language || "en",
      },
    });
  }, [
    vadConfig,
    selectedAudioDevices.output.id,
    selectedSttProvider.variables,
    clearRealtimePending,
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
  ]);

  const stopCapture = useCallback(async () => {
    try {
      // Abort any ongoing AI requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Stop the audio capture
      await invoke<string>("stop_system_audio_capture");

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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, [clearRealtimePending]);

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
    const shouldAutoOpen =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    if (shouldAutoOpen) {
      setIsPopoverOpen(true);
      resizeWindow(true);
    }
  }, [
    capturing,
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
    }
  }, [vadConfig, capturing, restartCaptureForMode]);

  const scrollRealtimeIntoView = useCallback(() => {
    const scrollElement = scrollAreaRef.current?.querySelector(
      "[data-slot='scroll-area-viewport']"
    ) as HTMLElement | null;
    if (!scrollElement) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, []);

  useEffect(() => {
    if (!isRealtimeMode) return;
    scrollRealtimeIntoView();
  }, [isRealtimeMode, realtimeSegments, realtimePendingDelta, scrollRealtimeIntoView]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-slot='scroll-area-viewport']"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

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
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
  };
}
