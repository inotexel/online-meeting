import { useCallback, useEffect, useRef, useState } from "react";

import { TYPE_PROVIDER } from "@/types";

import {
  appendUtteranceToGraph,

  applyMemoryToGraph,

  endMeetingGraph,

  extractMeetingMemory,

  getClientGraphContext,

  getProviderApiKey,

  isKnowledgeConfigured,

  listKnownClients,

  KnownClient,

  slugifyClientId,

  startMeetingGraph,

  testKnowledgeConnection,

} from "@/lib/memory";
import {
  syncSybillMeetings,
  SybillSyncProgress,
  SybillSyncResult,
} from "@/lib/sybill";
import { formatDialogueLine } from "@/lib/memory/dialogue";
import { takeRecentDialogueLines } from "@/lib/memory/meeting-context";

import { ClientGraphContext } from "@/lib/memory/types";

import { safeLocalStorage } from "@/lib";
import { shouldUsePluelyAPI } from "@/lib/functions/pluely.api";



const CLIENT_NAME_KEY = "pluely_meeting_client_name";

const SYBILL_API_KEY = "pluely_sybill_api_key";



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

  const [isMemorySyncing, setIsMemorySyncing] = useState(false);
  const [memorySyncError, setMemorySyncError] = useState("");

  const [sybillApiKey, setSybillApiKeyState] = useState(
    () => safeLocalStorage.getItem(SYBILL_API_KEY) ?? ""
  );
  const [knownClients, setKnownClients] = useState<KnownClient[]>([]);
  const [sybillSyncing, setSybillSyncing] = useState(false);
  const [sybillStatus, setSybillStatus] = useState("");
  const [sybillResult, setSybillResult] = useState<SybillSyncResult | null>(
    null
  );
  const [sybillCard, setSybillCard] = useState<SybillSyncProgress | null>(null);
  const sybillAbortRef = useRef<AbortController | null>(null);



  const clientIdRef = useRef("");

  const graphMeetingIdRef = useRef("");

  const transcriptBufferRef = useRef<string[]>([]);

  const meetingUtterancesRef = useRef<string[]>([]);

  const syncInFlightRef = useRef(false);

  const abortRef = useRef<AbortController | null>(null);
  const liveTranscriptSnapshotRef = useRef("");

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



  const syncMeetingMemory = useCallback(
    async () => {
      if (!graphMeetingIdRef.current) return;

      const activeClientId =
        clientIdRef.current || slugifyClientId(clientName.trim());
      if (!activeClientId) return;
      clientIdRef.current = activeClientId;

      if (syncInFlightRef.current) return;

      const extractionTranscript = transcriptBufferRef.current.join("\n").trim();
      if (!extractionTranscript) return;

      if (!knowledgeConfigured) {
        const configured = await isKnowledgeConfigured();
        setKnowledgeConfigured(configured);
        if (!configured) {
          setMemorySyncError(
            "Neo4j is not configured in this build."
          );
          return;
        }
      }

      const usePluelyApi = await shouldUsePluelyAPI();
      if (!ai.provider && !usePluelyApi) {
        setMemorySyncError(
          "Select a valid AI provider in Dev Space — memory sync needs it."
        );
        return;
      }
      if (
        !usePluelyApi &&
        !getProviderApiKey(ai.selectedProvider.variables)
      ) {
        setMemorySyncError(
          "Add an API key in Dev Space → Chat AI (or the same provider under Speech-to-text / Whisper brain)."
        );
        return;
      }

      syncInFlightRef.current = true;
      setIsMemorySyncing(true);
      setMemorySyncError("");
      const cycleAbort = new AbortController();
      abortRef.current = cycleAbort;

      try {
        let context = await refreshClientContext();

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
          await refreshClientContext();
        } else if (memoryResult.error) {
          setMemorySyncError(memoryResult.error);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error("Meeting memory sync failed:", error);
        setMemorySyncError(message);
      } finally {
        syncInFlightRef.current = false;
        setIsMemorySyncing(false);
      }
    },
    [
      ai.provider,
      ai.selectedProvider,
      clientName,
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

    await syncMeetingMemory();

    try {

      await endMeetingGraph(graphMeetingIdRef.current);

    } catch (error) {

      console.error("Failed to end meeting graph:", error);

    }

    graphMeetingIdRef.current = "";

    transcriptBufferRef.current = [];

    meetingUtterancesRef.current = [];

    setMemorySyncError("");
  }, [knowledgeConfigured, syncMeetingMemory]);



  useEffect(() => {

    if (clientName.trim()) {

      clientIdRef.current = slugifyClientId(clientName);

      refreshClientContext();

    }

  }, [clientName, refreshClientContext]);



  const setSybillApiKey = useCallback((key: string) => {
    setSybillApiKeyState(key);
    safeLocalStorage.setItem(SYBILL_API_KEY, key);
  }, []);

  const refreshKnownClients = useCallback(async () => {
    const configured = await isKnowledgeConfigured();
    setKnowledgeConfigured(configured);
    if (!configured) {
      setKnownClients([]);
      return [];
    }
    const clients = await listKnownClients();
    setKnownClients(clients);
    return clients;
  }, []);

  const runSybillSync = useCallback(async () => {
    if (sybillSyncing) return null;
    const key = sybillApiKey.trim();
    if (!key) {
      setSybillStatus("Add your Sybill API key first.");
      return null;
    }

    const configured = await isKnowledgeConfigured();
    setKnowledgeConfigured(configured);
    if (!configured) {
      setSybillStatus(
        "Neo4j is not configured in this build."
      );
      return null;
    }

    if (!ai.provider) {
      setSybillStatus(
        "Select an AI provider in Dev Space — needed to summarize meetings."
      );
      return null;
    }

    const usePluelyApi = await shouldUsePluelyAPI();
    if (!usePluelyApi && !getProviderApiKey(ai.selectedProvider.variables)) {
      setSybillStatus(
        "Add an API key in Dev Space → Chat AI (or matching STT / Whisper key)."
      );
      return null;
    }

    setSybillSyncing(true);
    setSybillResult(null);
    setSybillCard(null);
    setSybillStatus("Connecting to Sybill…");
    const abort = new AbortController();
    sybillAbortRef.current = abort;

    try {
      const result = await syncSybillMeetings({
        apiKey: key,
        ai: { provider: ai.provider, selectedProvider: ai.selectedProvider },
        signal: abort.signal,
        onProgress: (progress) => {
          setSybillCard(progress);
          setSybillStatus(
            `${progress.message} (${progress.imported} imported, ${progress.skipped} skipped)`
          );
        },
      });

      setSybillResult(result);
      setSybillCard(null);
      setSybillStatus(
        `Done · ${result.imported} imported, ${result.skipped} already synced` +
          (result.errors.length ? `, ${result.errors.length} errors` : "")
      );
      await refreshKnownClients();
      await refreshClientContext();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSybillStatus(`Sync failed: ${message}`);
      return null;
    } finally {
      setSybillSyncing(false);
      setSybillCard(null);
      sybillAbortRef.current = null;
    }
  }, [
    ai.provider,
    ai.selectedProvider,
    refreshClientContext,
    refreshKnownClients,
    sybillApiKey,
    sybillSyncing,
  ]);

  const cancelSybillSync = useCallback(() => {
    sybillAbortRef.current?.abort();
  }, []);

  const getRecentMeetingDialogue = useCallback(() => {
    const live = liveTranscriptSnapshotRef.current.trim();
    if (live) {
      return takeRecentDialogueLines(live.split("\n"));
    }
    return takeRecentDialogueLines(meetingUtterancesRef.current);
  }, []);

  const getMeetingTranscriptForAsk = useCallback(() => {
    return getRecentMeetingDialogue();
  }, [getRecentMeetingDialogue]);

  useEffect(() => {
    void refreshKnownClients();
  }, [refreshKnownClients]);

  return {

    clientName,

    setClientName,

    clientId: clientIdRef.current || slugifyClientId(clientName.trim()),

    knowledgeConfigured,

    knowledgeStatus,

    clientContext,

    isMemorySyncing,
    memorySyncError,
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

    endGraphMeeting,

    getMeetingTranscriptForAsk,

    getRecentMeetingDialogue,

    // Sybill sync
    sybillApiKey,
    setSybillApiKey,
    sybillSyncing,
    sybillStatus,
    sybillResult,
    sybillCard,
    knownClients,
    refreshKnownClients,
    runSybillSync,
    cancelSybillSync,

  };

}


