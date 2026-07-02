import { useCallback, useRef, useState } from "react";
import { TYPE_PROVIDER } from "@/types";
import { ClientGraphContext } from "@/lib/memory/types";
import {
  buildDocSearchQuery,
  filterRelevantDocChunks,
} from "@/lib/memory/doc-search";
import { searchClientDocuments } from "@/lib/memory/documents-api";
import {
  EMPTY_WHISPER_BRAIN_STATE,
  runWhisperBrain,
  WhisperBrainState,
} from "@/lib/memory/whisper-brain";

export interface VadWhisper {
  text: string;
  why: string;
  stage: string;
}

const WHISPER_COOLDOWN_MS = 40_000;
const WHISPER_DISMISS_MS = 18_000;

type CoachBlockedReason = "neo4j" | "client_name" | "ai_provider" | null;

export function useVadWhisperCoach(ai: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: { provider: string; variables: Record<string, string> };
  clientContext: ClientGraphContext | null;
  clientId: string;
  clientName: string;
  knowledgeConfigured: boolean;
  openaiApiKey?: string;
}) {
  const brainStateRef = useRef<WhisperBrainState>({ ...EMPTY_WHISPER_BRAIN_STATE });
  const lastWhisperAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentProspectLinesRef = useRef<string[]>([]);

  const [whisper, setWhisper] = useState<VadWhisper | null>(null);
  const [lastProspectLine, setLastProspectLine] = useState("");
  const [coachStatus, setCoachStatus] = useState("");
  const [coachLastError, setCoachLastError] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [meetingStage, setMeetingStage] = useState("unknown");

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      setWhisper(null);
    }, WHISPER_DISMISS_MS);
  }, [clearDismissTimer]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    brainStateRef.current = { ...EMPTY_WHISPER_BRAIN_STATE };
    lastWhisperAtRef.current = 0;
    recentProspectLinesRef.current = [];
    clearDismissTimer();
    setWhisper(null);
    setLastProspectLine("");
    setCoachStatus("");
    setCoachLastError("");
    setIsThinking(false);
    setMeetingStage("unknown");
  }, [clearDismissTimer]);

  const feedProspectLine = useCallback(
    async (prospectLine: string) => {
      const trimmed = prospectLine.trim();
      if (!trimmed) return;

      if (inFlightRef.current) return;
      if (!ai.provider) {
        setCoachLastError(
          "Select an AI provider in Dev Space — coach needs it for whispers."
        );
        return;
      }

      setLastProspectLine(trimmed);
      setIsThinking(true);
      setCoachLastError("");

      const recentLines = [...recentProspectLinesRef.current, trimmed].slice(-5);
      recentProspectLinesRef.current = recentLines;

      inFlightRef.current = true;
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        let docChunks: Awaited<ReturnType<typeof searchClientDocuments>> = [];
        const searchQuery = buildDocSearchQuery(recentLines.join("\n"));
        if (
          ai.knowledgeConfigured &&
          ai.clientId &&
          ai.openaiApiKey?.trim() &&
          searchQuery
        ) {
          try {
            docChunks = await searchClientDocuments({
              clientId: ai.clientId,
              query: searchQuery,
              openaiApiKey: ai.openaiApiKey.trim(),
              limit: 5,
            });
          } catch (error) {
            console.error("Whisper doc search failed:", error);
          }
        }

        const relevantDocChunks = filterRelevantDocChunks(
          docChunks.map((chunk) => ({
            documentTitle: chunk.documentTitle,
            text: chunk.text,
            score: chunk.score,
          }))
        );

        const result = await runWhisperBrain({
          provider: ai.provider,
          selectedProvider: ai.selectedProvider,
          previousState: brainStateRef.current,
          prospectLine: trimmed,
          clientContext: ai.knowledgeConfigured ? ai.clientContext : null,
          docChunks: relevantDocChunks,
          signal: abort.signal,
        });

        brainStateRef.current = result.state;
        setMeetingStage(result.stage);

        if (result.error) {
          setCoachLastError(result.error);
          setCoachStatus("Listening…");
          return;
        }

        if (!result.speak) {
          setCoachStatus(`Listening · ${result.stage.replace(/_/g, " ")}`);
          return;
        }

        const now = Date.now();
        const sinceLast = now - lastWhisperAtRef.current;
        if (lastWhisperAtRef.current > 0 && sinceLast < WHISPER_COOLDOWN_MS) {
          setCoachStatus("Heard — staying quiet (cooldown)");
          return;
        }

        const normalized = result.whisper.trim().toLowerCase();
        const alreadySaid = brainStateRef.current.whispers_given.some(
          (w) => w.trim().toLowerCase() === normalized
        );
        if (alreadySaid) {
          setCoachStatus("Already whispered that — staying quiet");
          return;
        }

        lastWhisperAtRef.current = now;
        if (!brainStateRef.current.whispers_given.includes(result.whisper)) {
          brainStateRef.current = {
            ...brainStateRef.current,
            whispers_given: [
              ...brainStateRef.current.whispers_given,
              result.whisper,
            ],
          };
        }

        setWhisper({
          text: result.whisper,
          why: result.why,
          stage: result.stage,
        });
        scheduleDismiss();
        setCoachStatus("Whisper");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setCoachLastError(message);
        setCoachStatus("Coach error");
      } finally {
        inFlightRef.current = false;
        setIsThinking(false);
        abortRef.current = null;
      }
    },
    [
      ai.clientContext,
      ai.clientId,
      ai.knowledgeConfigured,
      ai.openaiApiKey,
      ai.provider,
      ai.selectedProvider,
      scheduleDismiss,
    ]
  );

  return {
    whisper,
    lastProspectLine,
    coachStatus,
    coachLastError,
    isThinking,
    meetingStage,
    feedProspectLine,
    reset,
    getBrainState: () => brainStateRef.current,
    getRecentProspectLines: () => [...recentProspectLinesRef.current],
    coachBlockedReason: (!ai.knowledgeConfigured
      ? "neo4j"
      : !ai.clientName.trim()
        ? "client_name"
        : !ai.provider
          ? "ai_provider"
          : null) as CoachBlockedReason,
  };
}
