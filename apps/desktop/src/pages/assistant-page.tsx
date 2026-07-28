import { Thread } from "@/components/thread";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AssistantPage() {
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col pt-10">
        <div className="min-h-0 flex-1">
          <Thread />
        </div>
      </div>
    </TooltipProvider>
  );
}
