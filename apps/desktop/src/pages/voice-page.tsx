import { Thread } from "@/components/thread";
import { VoiceControl } from "@/components/voice";
import { AuiIf } from "@assistant-ui/react";

export default function Chat() {
  return (
    <div className="flex h-full flex-col">
      <AuiIf condition={(s) => s.thread.capabilities.voice}>
        <VoiceControl />
      </AuiIf>
      <div className="min-h-0 flex-1">
        <Thread />
      </div>
    </div>
  );
}
