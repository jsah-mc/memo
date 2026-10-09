import { useState } from "react";
import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { CreateAgentDialog } from "@/agents/create-agent-dialog";
import { useAgents } from "@/agents/agent-provider";
import { AgentActivityFace } from "@/agents/agent-activity";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function AgentSidebarSection({
  search = "",
}: Readonly<{ search?: string }>) {
  const { agents, activeAgent, selectAgent, deleteAgent } = useAgents();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visibleAgents = agents.filter((agent) =>
    `${agent.name} ${agent.role}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteAgent(id);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not delete the agent.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <SidebarGroup className="shrink-0 px-2.5 pt-3 pb-2">
      <SidebarGroupLabel className="text-xs font-medium">
        Agents
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="mb-1">
          <CreateAgentDialog />
        </div>
        <SidebarMenu className="gap-1">
          {visibleAgents.map((agent) => (
            <SidebarMenuItem key={agent.id}>
              <SidebarMenuButton
                isActive={agent.id === activeAgent.id}
                aria-pressed={agent.id === activeAgent.id}
                onClick={() => selectAgent(agent.id)}
                className="h-11 rounded-xl data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                tooltip={`${agent.name} — ${agent.role}`}
              >
                <AgentActivityFace
                  agentId={agent.id}
                  className="flex size-8 shrink-0 items-center justify-center font-mono text-xs font-bold text-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {agent.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {agent.role}
                  </span>
                </span>
              </SidebarMenuButton>
              {!agent.builtIn && (
                <SidebarMenuAction
                  aria-label={`Delete ${agent.name}`}
                  disabled={deletingId === agent.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(agent.id);
                  }}
                  className="opacity-55 hover:opacity-100"
                >
                  {deletingId === agent.id ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                </SidebarMenuAction>
              )}
            </SidebarMenuItem>
          ))}
          {visibleAgents.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              No matching agents
            </li>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
