import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Empty } from "@/components";
import { PageLayout } from "@/layouts";
import {
  listRealtimeSessions,
  RealtimeSessionSummary,
} from "@/lib/database/realtime-transcript.action";
import { HistoryIcon, UsersIcon } from "lucide-react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { formatDuration, formatSessionDate } from "./utils";

const Transcripts = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<RealtimeSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listRealtimeSessions();
      setSessions(rows.filter((session) => session.line_count > 0));
    } catch (err) {
      console.error("Failed to load transcription sessions:", err);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const groupedSessions = sessions.reduce(
    (acc, session) => {
      const dateKey = moment(session.started_at).format("YYYY-MM-DD");
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(session);
      return acc;
    },
    {} as Record<string, RealtimeSessionSummary[]>
  );

  const sortedDates = Object.keys(groupedSessions).sort((a, b) =>
    moment(b).diff(moment(a))
  );

  return (
    <PageLayout
      title="Transcriptions"
      description="Saved realtime transcription sessions from system audio capture."
    >
      {sessions.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={HistoryIcon}
          title="No transcriptions yet"
          description="Start Realtime mode in the headphones panel to save transcripts here."
        />
      ) : (
        <div className="flex flex-col gap-6 pb-8">
          {sortedDates.map((dateKey) => (
            <div key={dateKey} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground select-none font-medium">
                {moment(dateKey).format("ddd, MMM D")}
              </p>
              <div className="grid grid-cols-1 gap-3">
                {groupedSessions[dateKey].map((session) => (
                  <Card
                    key={session.id}
                    className="shadow-none select-none p-4 gap-0 group relative transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50 cursor-pointer"
                    onClick={() => navigate(`/transcripts/view/${session.id}`)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-sm">
                          {formatSessionDate(session.started_at)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDuration(session.started_at, session.ended_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Badge variant="outline" className="text-xs">
                          {session.line_count}{" "}
                          {session.line_count === 1 ? "line" : "lines"}
                        </Badge>
                        {session.has_speaker_labels > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <UsersIcon className="h-3 w-3" />
                            Speakers
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {moment(session.started_at).format("hh:mm A")}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
};

export default Transcripts;
