import { useCompletion, type MeetingAskBridge } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Input } from "./Input";

export const Completion = ({
  isHidden,
  meetingAsk,
  embedded = false,
}: {
  isHidden: boolean;
  meetingAsk?: MeetingAskBridge;
  embedded?: boolean;
}) => {
  const completion = useCompletion({ meetingAsk, embedded });

  return (
    <>
      <Input {...completion} isHidden={isHidden} embedded={embedded} />
      {!embedded && <Screenshot {...completion} />}
      {!embedded && <Files {...completion} />}
    </>
  );
};
