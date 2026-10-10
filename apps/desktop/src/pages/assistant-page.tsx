import { Thread } from "@/components/thread";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AssistantPage() {
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col pt-14">
        <div className="min-h-0 flex-1 overflow-hidden border-x border-b border-border/55 bg-card/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <Thread />
        </div>
      </div>
    </TooltipProvider>
  );
}
