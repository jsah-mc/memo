import { useAgents } from "@/agents/agent-provider";

export default function Titlebar() {
  const { activeAgent } = useAgents();

  return (
    <header className="liquid-titlebar drag fixed top-0 right-0 left-72 z-50 flex h-14 items-center px-3 text-foreground">
      <div className="pointer-events-none flex min-w-0 items-center gap-2.5 pl-1">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {activeAgent.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 text-left">
          <span className="block max-w-56 truncate text-sm font-semibold">{activeAgent.name}</span>
          <span className="block max-w-56 truncate text-[11px] text-muted-foreground">{activeAgent.role}</span>
        </span>
      </div>
    </header>
  );
}
