import { useEffect, useState } from "react";
import { Badge, Empty } from "@/components";
import { PageLayout } from "@/layouts";
import {
  getRealtimeSession,
  getRealtimeSessionSegments,
  RealtimeSessionSummary,
} from "@/lib/database/realtime-transcript.action";
import {
  LiveTranscript,
  LiveTranscriptSegment,
} from "@/pages/app/components/speech/LiveTranscript";
import { ClockIcon, HistoryIcon, UsersIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { formatDuration, formatSessionDate, toLiveSegments } from "../utils";

const ViewTranscript = () => {
  const { sessionId } = useParams();
  const [session, setSession] = useState<RealtimeSessionSummary | null>(null);
  const [segments, setSegments] = useState<LiveTranscriptSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!sessionId) return;
      setIsLoading(true);
      try {
        const [sessionRow, segmentRows] = await Promise.all([
          getRealtimeSession(sessionId),
          getRealtimeSessionSegments(sessionId),
        ]);
        setSession(sessionRow);
        setSegments(toLiveSegments(segmentRows));
      } catch (err) {
        console.error("Failed to load transcript session:", err);
        setSession(null);
        setSegments([]);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [sessionId]);

  const showSpeakerLabels = Boolean(
    session?.has_speaker_labels ||
      segments.some((segment) => segment.speakerLabel)
  );

  if (!isLoading && !session) {
    return (
      <PageLayout
        title="Transcription"
        description="Session not found"
        allowBackButton
      >
        <Empty
          icon={HistoryIcon}
          title="Session not found"
          description="This transcription session may have been removed."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={session ? formatSessionDate(session.started_at) : "Transcription"}
      description="Saved realtime transcription session"
      allowBackButton
    >
      {isLoading ? (
        <Empty isLoading icon={HistoryIcon} title="Loading transcript…" description="" />
      ) : (
        <div className="flex flex-col gap-4 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <ClockIcon className="h-3 w-3" />
              {formatDuration(session!.started_at, session!.ended_at)}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {session!.line_count}{" "}
              {session!.line_count === 1 ? "line" : "lines"}
            </Badge>
            {showSpeakerLabels && (
              <Badge variant="outline" className="text-xs gap-1">
                <UsersIcon className="h-3 w-3" />
                Speakers
              </Badge>
            )}
          </div>

          <LiveTranscript
            segments={segments}
            pendingDelta=""
            isSessionActive={false}
            showSpeakerLabels={showSpeakerLabels}
            readOnly
            displayMode="scroll"
            title="Session transcript"
            maxHeightClass="max-h-none"
            emptyMessage="No transcript lines saved for this session."
          />
        </div>
      )}
    </PageLayout>
  );
};

export default ViewTranscript;
