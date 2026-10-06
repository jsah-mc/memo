import type { ReactNode } from "react";
import { SparklesIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import { CreateAgentDialog } from "@/agents/create-agent-dialog";
import { Button } from "@/components/ui/button";
import Titlebar from "@/components/titlebar";

export function AgentSetupGate({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { agents, loaded, loadError, reload } = useAgents();
  if (loaded && agents.length) return children;
  return (
    <main className="flex h-dvh items-center justify-center bg-background text-foreground">
      <Titlebar />
      <div className="grid max-w-md justify-items-center gap-4 px-6 text-center">
        <SparklesIcon className="size-10 text-primary" />
        <h1 className="text-2xl font-semibold">Welcome to Memo</h1>
        {loadError ? (
          <>
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
            <Button onClick={reload}>Try again</Button>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {loaded
              ? "Let's create an agent that feels like yours."
              : "Loading your agents…"}
          </p>
        )}
      </div>
      {loaded && !agents.length && <CreateAgentDialog onboarding />}
    </main>
  );
}
