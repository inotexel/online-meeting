import { useCallback, useRef, useState } from "react";

import { TYPE_PROVIDER } from "@/types";

import { ClientGraphContext } from "@/lib/memory/types";

import {

  buildDocSearchQuery,

  selectDocChunksForWhisper,

  WHISPER_MIN_DOC_RELEVANCE_SCORE,

} from "@/lib/memory/doc-search";

import { searchClientDocumentsWithTimeout } from "@/lib/memory/documents-api";

import { isCoachProviderReady } from "@/lib/storage/coach-ai-config";

import { DialogueSpeaker } from "@/lib/memory/dialogue";

import { MeetingAiContext, mergeClientContextWithKnownClients, enrichClientContextForAi } from "@/lib/memory/meeting-context";

import {

  EMPTY_WHISPER_BRAIN_STATE,

  runWhisperBrain,

  WhisperBrainState,

} from "@/lib/memory/whisper-brain";



export interface VadWhisper {

  text: string;

  why: string;

  stage: string;

  /** Client line → what to say next; user line → rephrase or emphasize. */
  intent: "say_this" | "rephrase";

}



const WHISPER_DISMISS_MS = 18_000;

/** Wait for VAD/STT to finish splitting one utterance before calling the brain. */
const WHISPER_FEED_DEBOUNCE_MS = 2_500;

/** Minimum gap between whispers shown in the UI. */
const WHISPER_DISPLAY_COOLDOWN_MS = 12_000;

/** Skip near-duplicate lines from repeated VAD segments. */
const WHISPER_DEDUPE_WINDOW_MS = 45_000;

interface ProcessedFeed {
  speaker: DialogueSpeaker;
  text: string;
  at: number;
}

function normalizeFeedText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNearDuplicateFeed(
  speaker: DialogueSpeaker,
  text: string,
  recent: ProcessedFeed[]
): boolean {
  const normalized = normalizeFeedText(text);
  if (!normalized) return true;

  const now = Date.now();
  for (const entry of recent) {
    if (now - entry.at > WHISPER_DEDUPE_WINDOW_MS) continue;
    if (entry.speaker !== speaker) continue;

    const previous = normalizeFeedText(entry.text);
    if (!previous) continue;
    if (normalized === previous) return true;

    const shorter =
      normalized.length <= previous.length ? normalized : previous;
    const longer =
      normalized.length > previous.length ? normalized : previous;
    if (shorter.length >= 24 && longer.includes(shorter)) return true;
  }

  return false;
}



type CoachBlockedReason = "neo4j" | "client_name" | "ai_provider" | null;



function formatLineForContext(speaker: DialogueSpeaker, text: string): string {

  const trimmed = text.trim();

  if (!trimmed) return "";

  return speaker === "user" ? `User: ${trimmed}` : `Client: ${trimmed}`;

}



function recentDialogueExcludingLine(

  recentDialogue: string,

  labeledLine: string

): string {

  const lines = recentDialogue

    .split("\n")

    .map((line) => line.trim())

    .filter(Boolean);

  if (lines.length > 0 && lines[lines.length - 1] === labeledLine.trim()) {

    return lines.slice(0, -1).join("\n");

  }

  return recentDialogue;

}



export function useVadWhisperCoach(ai: {

  resolveCoachProvider: () => {
    provider: TYPE_PROVIDER | undefined;
    selectedProvider: { provider: string; variables: Record<string, string> };
  };

  clientContext: ClientGraphContext | null;

  clientId: string;

  clientName: string;

  knowledgeConfigured: boolean;

  openaiApiKey?: string;

  getRecentMeetingDialogue: () => string;

  refreshClientContext: () => Promise<ClientGraphContext | null>;

  refreshKnownClients?: () => Promise<
    { clientId: string; clientName: string; meetingCount: number }[]
  >;

  getActiveMeetingId: () => string;

  knownClients?: { clientId: string; clientName: string; meetingCount: number }[];

}) {

  const brainStateRef = useRef<WhisperBrainState>({ ...EMPTY_WHISPER_BRAIN_STATE });

  const abortRef = useRef<AbortController | null>(null);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const brainQueueRef = useRef<Promise<void>>(Promise.resolve());

  const feedDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const pendingFeedRef = useRef<{
    speaker: DialogueSpeaker;
    line: string;
  } | null>(null);

  const recentlyProcessedRef = useRef<ProcessedFeed[]>([]);

  const lastWhisperShownAtRef = useRef(0);

  const processTokenRef = useRef(0);



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

    if (feedDebounceTimerRef.current) {

      clearTimeout(feedDebounceTimerRef.current);

      feedDebounceTimerRef.current = null;

    }

    pendingFeedRef.current = null;

    recentlyProcessedRef.current = [];

    lastWhisperShownAtRef.current = 0;

    processTokenRef.current = 0;

    brainQueueRef.current = Promise.resolve();

    brainStateRef.current = { ...EMPTY_WHISPER_BRAIN_STATE };

    clearDismissTimer();

    setWhisper(null);

    setLastProspectLine("");

    setCoachStatus("");

    setCoachLastError("");

    setIsThinking(false);

    setMeetingStage("unknown");

  }, [clearDismissTimer]);



  const processDialogueLine = useCallback(

    async (
      speaker: DialogueSpeaker,
      line: string,
      processToken: number
    ) => {

      const trimmed = line.trim();

      if (!trimmed) return;

      if (isNearDuplicateFeed(speaker, trimmed, recentlyProcessedRef.current)) {

        return;

      }

      recentlyProcessedRef.current.push({
        speaker,
        text: trimmed,
        at: Date.now(),
      });

      const { provider, selectedProvider } = ai.resolveCoachProvider();

      if (!isCoachProviderReady(provider, selectedProvider)) {

        setCoachLastError(

          "Add an OpenAI API key in Dev Space → STT (or Whisper AI) for coaching."

        );

        return;

      }



      if (speaker === "client") {

        setLastProspectLine(trimmed);

      }



      setIsThinking(true);

      setCoachLastError("");



      const labeledLine = formatLineForContext(speaker, trimmed);

      const recentDialogue = recentDialogueExcludingLine(

        ai.getRecentMeetingDialogue(),

        labeledLine

      );



      const abort = new AbortController();

      abortRef.current?.abort();

      abortRef.current = abort;



      try {

        let clientContext = ai.clientContext;
        if (ai.knowledgeConfigured) {
          try {
            const knownClients =
              (await ai.refreshKnownClients?.()) ?? ai.knownClients ?? [];
            clientContext =
              (await ai.refreshClientContext()) ?? ai.clientContext;
            clientContext = mergeClientContextWithKnownClients(
              clientContext,
              ai.clientName,
              ai.clientId,
              knownClients
            );
            clientContext = await enrichClientContextForAi(
              clientContext,
              ai.clientId,
              ai.clientName
            );
          } catch (error) {
            console.warn("Whisper client context refresh skipped:", error);
          }
        }

        let docChunks: Awaited<ReturnType<typeof searchClientDocumentsWithTimeout>> = [];

        const searchQuery = buildDocSearchQuery(

          [recentDialogue, labeledLine].filter(Boolean).join("\n")

        );



        if (

          ai.knowledgeConfigured &&

          ai.clientId &&

          ai.openaiApiKey?.trim() &&

          searchQuery

        ) {

          try {

            docChunks = await searchClientDocumentsWithTimeout({

              clientId: ai.clientId,

              query: searchQuery,

              openaiApiKey: ai.openaiApiKey.trim(),

              limit: 5,

              minScore: WHISPER_MIN_DOC_RELEVANCE_SCORE,

            });

          } catch (error) {

            console.warn("Whisper doc search skipped:", error);

          }

        }



        const relevantDocChunks = selectDocChunksForWhisper(

          docChunks.map((chunk) => ({

            documentTitle: chunk.documentTitle,

            text: chunk.text,

            score: chunk.score,

          }))

        );



        const meetingContext: MeetingAiContext = {

          brainState: brainStateRef.current,

          recentDialogue,

          clientContext: ai.knowledgeConfigured ? clientContext : null,

          docChunks: relevantDocChunks,

          activeMeetingId: ai.getActiveMeetingId() || undefined,

        };



        const result = await runWhisperBrain({

          provider,

          selectedProvider,

          meetingContext,

          speaker,

          line: trimmed,

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



        if (processToken !== processTokenRef.current) {

          setCoachStatus(`Listening · ${result.stage.replace(/_/g, " ")}`);

          return;

        }



        const sinceLastWhisper = Date.now() - lastWhisperShownAtRef.current;

        if (
          lastWhisperShownAtRef.current > 0 &&
          sinceLastWhisper < WHISPER_DISPLAY_COOLDOWN_MS
        ) {

          setCoachStatus(`Listening · ${result.stage.replace(/_/g, " ")}`);

          return;

        }



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

          intent: speaker === "user" ? "rephrase" : "say_this",

        });

        lastWhisperShownAtRef.current = Date.now();

        scheduleDismiss();

        setCoachStatus("Whisper");

      } catch (error) {

        const message = error instanceof Error ? error.message : String(error);

        setCoachLastError(message);

        setCoachStatus("Coach error");

      } finally {

        setIsThinking(false);

        abortRef.current = null;

      }

    },

    [

      ai.clientContext,

      ai.clientId,

      ai.getRecentMeetingDialogue,

      ai.getActiveMeetingId,

      ai.knowledgeConfigured,

      ai.openaiApiKey,

      ai.refreshClientContext,

      ai.refreshKnownClients,

      ai.knownClients,

      ai.clientName,

      ai.resolveCoachProvider,

      scheduleDismiss,

    ]

  );



  const flushPendingFeed = useCallback(() => {

    const pending = pendingFeedRef.current;

    pendingFeedRef.current = null;

    if (!pending) return;

    const token = ++processTokenRef.current;

    brainQueueRef.current = brainQueueRef.current

      .then(() => processDialogueLine(pending.speaker, pending.line, token))

      .catch((error) => {

        console.error("Whisper brain queue error:", error);

      });

  }, [processDialogueLine]);



  const feedDialogueLine = useCallback(

    (speaker: DialogueSpeaker, line: string) => {

      const trimmed = line.trim();

      if (!trimmed) return;

      const pending = pendingFeedRef.current;

      if (pending) {

        if (speaker === "client" || pending.speaker !== "client") {

          pendingFeedRef.current = { speaker, line: trimmed };

        }

      } else {

        pendingFeedRef.current = { speaker, line: trimmed };

      }

      if (feedDebounceTimerRef.current) {

        clearTimeout(feedDebounceTimerRef.current);

      }

      feedDebounceTimerRef.current = setTimeout(() => {

        feedDebounceTimerRef.current = null;

        flushPendingFeed();

      }, WHISPER_FEED_DEBOUNCE_MS);

    },

    [flushPendingFeed]

  );



  return {

    whisper,

    lastProspectLine,

    coachStatus,

    coachLastError,

    isThinking,

    meetingStage,

    feedDialogueLine,

    reset,

    getBrainState: () => brainStateRef.current,

    coachBlockedReason: (() => {
      const { provider, selectedProvider } = ai.resolveCoachProvider();
      if (!ai.knowledgeConfigured) return "neo4j" as CoachBlockedReason;
      if (!ai.clientName.trim()) return "client_name" as CoachBlockedReason;
      if (!isCoachProviderReady(provider, selectedProvider)) {
        return "ai_provider" as CoachBlockedReason;
      }
      return null;
    })(),

  };

};


