import {
  RealtimeTranscriptSegment,
} from "@/lib/database/realtime-transcript.action";
import { LiveTranscriptSegment } from "@/pages/app/components/speech/LiveTranscript";

export function formatSessionDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(
  startedAt: number,
  endedAt: number | null
): string {
  if (!endedAt) return "In progress";
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function toLiveSegments(
  segments: RealtimeTranscriptSegment[]
): LiveTranscriptSegment[] {
  return segments.map((segment) => ({
    id: segment.item_id ?? segment.id,
    text: segment.text,
    isFinal: Boolean(segment.is_final),
    speakerLabel: segment.speaker_label ?? null,
  }));
}
