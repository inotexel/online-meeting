import { useCallback, useEffect, useRef, useState } from "react";

import { TYPE_PROVIDER } from "@/types";

import {

  appendUtteranceToGraph,

  applyMemoryToGraph,

  endMeetingGraph,

  extractMeetingMemory,

  generateCoachSuggestions,

  getClientGraphContext,

  isKnowledgeConfigured,

  searchClientDocuments,

  slugifyClientId,

  startMeetingGraph,

  testKnowledgeConnection,

} from "@/lib/memory";
import { formatDialogueLine } from "@/lib/memory/dialogue";
import { docChunkToSuggestion } from "@/lib/memory/coach-doc-provenance";
import {
  buildDocSearchQuery,
  filterRelevantDocChunks,
} from "@/lib/memory/doc-search";

import { CoachSuggestion, ClientGraphContext } from "@/lib/memory/types";

import { safeLocalStorage } from "@/lib";
import { shouldUsePluelyAPI } from "@/lib/functions/pluely.api";



const CLIENT_NAME_KEY = "pluely_meeting_client_name";

const COACH_TICK_MS = 15_000;

const RECENT_UTTERANCE_LIMIT = 24;



export function useMeetingMemory(ai: {

  provider: TYPE_PROVIDER | undefined;

  selectedProvider: { provider: string; variables: Record<string, string> };

  openaiApiKey?: string;

}) {

  const [clientName, setClientNameState] = useState(

    () => safeLocalStorage.getItem(CLIENT_NAME_KEY) ?? ""

  );

  const [knowledgeConfigured, setKnowledgeConfigured] = useState(false);

  const [knowledgeStatus, setKnowledgeStatus] = useState<

    "unknown" | "connected" | "error"

  >("unknown");

  const [clientContext, setClientContext] = useState<ClientGraphContext | null>(

    null

  );

  const [coachSuggestions, setCoachSuggestions] = useState<CoachSuggestion[]>(

    []

  );

  const [isMemorySyncing, setIsMemorySyncing] = useState(false);
  const [coachStatus, setCoachStatus] = useState("");
  const [coachLastError, setCoachLastError] = useState("");



  const clientIdRef = useRef("");

  const graphMeetingIdRef = useRef("");

  const transcriptBufferRef = useRef<string[]>([]);

  const meetingUtterancesRef = useRef<string[]>([]);

  const lastCoachTickRef = useRef(0);

  const syncInFlightRef = useRef(false);

  const abortRef = useRef<AbortController | null>(null);
  const liveTranscriptSnapshotRef = useRef("");



  const getRecentMeetingTranscript = useCallback(() => {

    return meetingUtterancesRef.current.slice(-RECENT_UTTERANCE_LIMIT).join("\n");

  }, []);



  const setClientName = useCallback((name: string) => {

    setClientNameState(name);

    safeLocalStorage.setItem(CLIENT_NAME_KEY, name);

    clientIdRef.current = slugifyClientId(name.trim());

  }, []);



  useEffect(() => {
    void isKnowledgeConfigured().then(setKnowledgeConfigured);
  }, []);

  const refreshKnowledgeConfigured = useCallback(async () => {
    const configured = await isKnowledgeConfigured();
    setKnowledgeConfigured(configured);
    return configured;
  }, []);

  const setLiveTranscriptSnapshot = useCallback((text: string) => {
    liveTranscriptSnapshotRef.current = text;
  }, []);



  const refreshClientContext = useCallback(async () => {

    if (!knowledgeConfigured || !clientIdRef.current) return null;

    try {

      const context = await getClientGraphContext(clientIdRef.current);

      setClientContext(context);

      return context;

    } catch (error) {

      console.error("Failed to load client context:", error);

      return null;

    }

  }, [knowledgeConfigured]);



  const testConnection = useCallback(async () => {

    try {

      const message = await testKnowledgeConnection();

      setKnowledgeStatus("connected");

      return message;

    } catch (error) {

      setKnowledgeStatus("error");

      throw error;

    }

  }, []);



  const startGraphMeeting = useCallback(

    async (meetingId: string) => {
      graphMeetingIdRef.current = meetingId;
      transcriptBufferRef.current = [];
      meetingUtterancesRef.current = [];
      lastCoachTickRef.current = Date.now();

      const configured = await isKnowledgeConfigured();
      setKnowledgeConfigured(configured);
      if (!configured) return;

      const name = clientName.trim();
      if (!name) return;

      clientIdRef.current = slugifyClientId(name);



      const context = await refreshClientContext();

      const meetingNumber = (context?.meetingCount ?? 0) + 1;



      await startMeetingGraph({

        clientId: clientIdRef.current,

        clientName: name,

        meetingId,

        meetingNumber,

      });

      await refreshClientContext();

    },

    [clientName, knowledgeConfigured, refreshClientContext]

  );



  const runCoachCycle = useCallback(

    async (force = false) => {
      if (!graphMeetingIdRef.current) {
        setCoachStatus("Waiting for meeting to start…");
        return;
      }

      const activeClientId =
        clientIdRef.current || slugifyClientId(clientName.trim());
      if (!activeClientId) {
        setCoachStatus("Waiting for client name…");
        return;
      }
      clientIdRef.current = activeClientId;

      if (syncInFlightRef.current) return;

      const now = Date.now();
      if (!force && now - lastCoachTickRef.current < COACH_TICK_MS) return;

      const recentTranscript =
        getRecentMeetingTranscript().trim() ||
        liveTranscriptSnapshotRef.current.trim();
      const extractionTranscript = transcriptBufferRef.current.join("\n").trim();
      if (!recentTranscript && !extractionTranscript) {
        setCoachStatus("Waiting for transcript…");
        return;
      }

      if (!knowledgeConfigured) {
        const configured = await isKnowledgeConfigured();
        setKnowledgeConfigured(configured);
        if (!configured) {
          setCoachLastError(
            "Neo4j not configured. Add NEO4J_* vars to src-tauri/.env and restart."
          );
          return;
        }
      }

      const usePluelyApi = await shouldUsePluelyAPI();
      if (!ai.provider && !usePluelyApi) {
        setCoachLastError(
          "Select a valid AI provider in Dev Space — coach needs it for suggestions."
        );
        return;
      }

      syncInFlightRef.current = true;
      setIsMemorySyncing(true);
      setCoachLastError("");
      const cycleAbort = new AbortController();
      abortRef.current = cycleAbort;
      lastCoachTickRef.current = now;

      try {
        let context = await refreshClientContext();

        if (extractionTranscript) {
          try {
            const memoryResult = await extractMeetingMemory({
              provider: ai.provider,
              selectedProvider: ai.selectedProvider,
              clientName: clientName.trim() || "Client",
              recentTranscript: extractionTranscript,
              existingContext: context ?? null,
              signal: cycleAbort.signal,
            });

            if (memoryResult.parsed) {
              await applyMemoryToGraph(
                clientIdRef.current,
                graphMeetingIdRef.current,
                memoryResult.extraction
              );
              transcriptBufferRef.current = [];
            } else if (memoryResult.error) {
              setCoachLastError(memoryResult.error);
            }
          } catch (error) {
            console.error("Memory extraction failed:", error);
          }
        }

        context =
          (await refreshClientContext()) ??
          context ?? {
            clientId: clientIdRef.current,
            clientName: clientName.trim() || "Client",
            facts: [],
            openObjections: [],
            openQuestions: [],
            openActions: [],
            meetingCount: 0,
          };

        const coachTranscript = recentTranscript || extractionTranscript;

        let docChunks: Awaited<ReturnType<typeof searchClientDocuments>> = [];
        if (ai.openaiApiKey?.trim() && coachTranscript) {
          try {
            const searchQuery = buildDocSearchQuery(coachTranscript);
            if (searchQuery) {
              docChunks = await searchClientDocuments({
                clientId: clientIdRef.current,
                query: searchQuery,
                openaiApiKey: ai.openaiApiKey.trim(),
                limit: 5,
              });
            }
          } catch (error) {
            console.error("Document search failed:", error);
          }
        }

        const relevantDocChunks = filterRelevantDocChunks(
          docChunks.map((chunk) => ({
            documentTitle: chunk.documentTitle,
            text: chunk.text,
            score: chunk.score,
          }))
        );

        if (!context) {
          setCoachLastError("Could not load client context from Neo4j.");
          return;
        }

        const coach = await generateCoachSuggestions({
          provider: ai.provider,
          selectedProvider: ai.selectedProvider,
          clientContext: context,
          recentTranscript: coachTranscript,
          docChunks: relevantDocChunks,
          signal: cycleAbort.signal,
        });

        if (coach.error) {
          setCoachLastError(coach.error);
          setCoachStatus("Coach cycle failed");
          return;
        }

        let suggestions = coach.suggestions;
        if (suggestions.length === 0 && coachTranscript.length > 20) {
          const topRelevant = relevantDocChunks[0];
          if (topRelevant) {
            suggestions = [docChunkToSuggestion(topRelevant)];
          }
        }

        if (suggestions.length > 0) {
          setCoachSuggestions(suggestions);
          setCoachStatus(
            `${suggestions.length} tip${suggestions.length === 1 ? "" : "s"} · ${new Date().toLocaleTimeString()}`
          );
        } else {
          setCoachStatus(
            `No substantive speech yet · ${new Date().toLocaleTimeString()}`
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error("Coach cycle failed:", error);
        setCoachLastError(message);
        setCoachStatus("Coach cycle failed");
      } finally {
        syncInFlightRef.current = false;
        setIsMemorySyncing(false);
      }
    },

    [
      ai.openaiApiKey,
      ai.provider,
      ai.selectedProvider,
      clientName,
      getRecentMeetingTranscript,
      knowledgeConfigured,
      refreshClientContext,
    ]

  );



  const appendUtterance = useCallback(

    async (params: {

      utteranceId: string;

      text: string;

      speakerLabel?: string | null;

      sequenceNum: number;

    }) => {
      transcriptBufferRef.current.push(
        formatDialogueLine(params.speakerLabel, params.text)
      );
      meetingUtterancesRef.current.push(
        formatDialogueLine(params.speakerLabel, params.text)
      );

      if (!knowledgeConfigured || !graphMeetingIdRef.current) return;

      try {
        await appendUtteranceToGraph({

          meetingId: graphMeetingIdRef.current,

          utteranceId: params.utteranceId,

          text: params.text,

          speakerLabel: params.speakerLabel,

          sequenceNum: params.sequenceNum,

        });

      } catch (error) {

        console.error("Failed to append utterance to graph:", error);

      }

    },

    [knowledgeConfigured]

  );



  const endGraphMeeting = useCallback(async () => {

    if (!knowledgeConfigured || !graphMeetingIdRef.current) return;

    await runCoachCycle(true);

    try {

      await endMeetingGraph(graphMeetingIdRef.current);

    } catch (error) {

      console.error("Failed to end meeting graph:", error);

    }

    graphMeetingIdRef.current = "";

    transcriptBufferRef.current = [];

    meetingUtterancesRef.current = [];

    setCoachSuggestions([]);
    setCoachStatus("");
    setCoachLastError("");
  }, [knowledgeConfigured, runCoachCycle]);



  useEffect(() => {

    if (clientName.trim()) {

      clientIdRef.current = slugifyClientId(clientName);

      refreshClientContext();

    }

  }, [clientName, refreshClientContext]);



  return {

    clientName,

    setClientName,

    clientId: clientIdRef.current || slugifyClientId(clientName.trim()),

    knowledgeConfigured,

    knowledgeStatus,

    clientContext,

    coachSuggestions,
    isMemorySyncing,
    coachStatus,
    coachLastError,
    coachBlockedReason: !knowledgeConfigured

      ? ("neo4j" as const)

      : !clientName.trim()

        ? ("client_name" as const)

        : !ai.provider

          ? ("ai_provider" as const)

          : null,

    refreshKnowledgeConfigured,

    setLiveTranscriptSnapshot,

    testConnection,

    refreshClientContext,

    startGraphMeeting,

    appendUtterance,

    runCoachCycle,

    endGraphMeeting,

  };

}


