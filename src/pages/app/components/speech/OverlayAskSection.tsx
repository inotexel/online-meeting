import { MessageSquareIcon } from "lucide-react";
import { Completion } from "../completion";
import type { MeetingAskBridge } from "@/hooks/useSystemAudio";

interface OverlayAskSectionProps {
  meetingAsk: MeetingAskBridge;
}

export function OverlayAskSection({ meetingAsk }: OverlayAskSectionProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        title="Ask anything"
      >
        <MessageSquareIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <Completion isHidden={false} meetingAsk={meetingAsk} embedded />
      </div>
    </div>
  );
}
