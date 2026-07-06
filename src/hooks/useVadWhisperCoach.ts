import { useCallback, useRef, useState } from "react";

import { TYPE_PROVIDER } from "@/types";

import { ClientGraphContext } from "@/lib/memory/types";

import {

  buildDocSearchQuery,

  filterRelevantDocChunks,

} from "@/lib/memory/doc-search";

import { searchClientDocuments } from "@/lib/memory/documents-api";

import { DialogueSpeaker } from "@/lib/memory/dialogue";

import { MeetingAiContext } from "@/lib/memory/meeting-context";

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



const WHISPER_DISMISS_MS = 18_000;



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

  provider: TYPE_PROVIDER | undefined;

  selectedProvider: { provider: string; variables: Record<string, string> };

  clientContext: ClientGraphContext | null;

  clientId: string;

  clientName: string;

  knowledgeConfigured: boolean;

  openaiApiKey?: string;

  getRecentMeetingDialogue: () => string;

}) {

  const brainStateRef = useRef<WhisperBrainState>({ ...EMPTY_WHISPER_BRAIN_STATE });

  const abortRef = useRef<AbortController | null>(null);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const brainQueueRef = useRef<Promise<void>>(Promise.resolve());



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

    async (speaker: DialogueSpeaker, line: string) => {

      const trimmed = line.trim();

      if (!trimmed) return;



      if (!ai.provider) {

        setCoachLastError(

          "Select an AI provider in Dev Space — coach needs it for whispers."

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

      abortRef.current = abort;



      try {

        let docChunks: Awaited<ReturnType<typeof searchClientDocuments>> = [];

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



        const meetingContext: MeetingAiContext = {

          brainState: brainStateRef.current,

          recentDialogue,

          clientContext: ai.knowledgeConfigured ? ai.clientContext : null,

          docChunks: relevantDocChunks,

        };



        const result = await runWhisperBrain({

          provider: ai.provider,

          selectedProvider: ai.selectedProvider,

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

        setIsThinking(false);

        abortRef.current = null;

      }

    },

    [

      ai.clientContext,

      ai.clientId,

      ai.getRecentMeetingDialogue,

      ai.knowledgeConfigured,

      ai.openaiApiKey,

      ai.provider,

      ai.selectedProvider,

      scheduleDismiss,

    ]

  );



  const feedDialogueLine = useCallback(

    (speaker: DialogueSpeaker, line: string) => {

      brainQueueRef.current = brainQueueRef.current

        .then(() => processDialogueLine(speaker, line))

        .catch((error) => {

          console.error("Whisper brain queue error:", error);

        });

    },

    [processDialogueLine]

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

    coachBlockedReason: (!ai.knowledgeConfigured

      ? "neo4j"

      : !ai.clientName.trim()

        ? "client_name"

        : !ai.provider

          ? "ai_provider"

          : null) as CoachBlockedReason,

  };

};


