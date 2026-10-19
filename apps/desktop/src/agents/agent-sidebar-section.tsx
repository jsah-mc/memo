import { useState } from "react";
import { LoaderCircleIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { CreateAgentDialog } from "@/agents/create-agent-dialog";
import { useAgents } from "@/agents/agent-provider";
import { AgentActivityFace } from "@/agents/agent-activity";
import { moderatedAgentColor } from "@/agents/agent-color";
import { CreateAgentGroupDialog } from "@/agents/create-agent-group-dialog";
import { EditAgentGroupDialog } from "@/agents/edit-agent-group-dialog";
import { useAgentGroups } from "@/agents/agent-groups";
import { useBotSettings } from "@/agents/bot-settings";
import { useWorkspaceStatus } from "@/agents/workspace-status";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

function BotStatus({
  agentId,
  agentName,
}: Readonly<{ agentId: string; agentName: string }>) {
  const bot = useBotSettings(agentId, agentName);
  if (!bot.enabled) return null;
  return (
    <span className="ml-2 border border-primary/50 px-1 font-mono text-[9px] text-primary">
      BOT /{bot.command}
    </span>
  );
}

function WorkspaceStatusBadge({ scope }: Readonly<{ scope: string }>) {
  const status = useWorkspaceStatus((state) => state.statuses[scope]);
  if (!status || (status.running === 0 && status.unread === 0)) return null;
  if (status.running > 0) {
    return <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-primary"><LoaderCircleIcon className="size-3 animate-spin" />{status.running}</span>;
  }
  return <span className={`ml-auto min-w-4 rounded-full px-1 text-center font-mono text-[9px] text-primary-foreground ${status.lastResult === "error" ? "bg-destructive" : "bg-primary"}`}>{status.unread}</span>;
}

export function AgentSidebarSection({
  search = "",
}: Readonly<{ search?: string }>) {
  const { agents, activeAgent, selectAgent, deleteAgent } = useAgents();
  const { groups, activeGroup, selectGroup, clearActiveGroup, deleteGroup } = useAgentGroups();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visibleAgents = agents.filter((agent) =>
    `${agent.name} ${agent.role}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
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

  const chooseAgent = (id: string) => {
    clearActiveGroup();
    selectAgent(id);
  };

  return (
    <SidebarGroup className="shrink-0 px-2.5 pt-3 pb-2">
      <SidebarGroupLabel className="text-xs font-medium">
        // AGENTS
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
                onClick={() => chooseAgent(agent.id)}
                className="h-11 rounded-sm data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                tooltip={`${agent.name} — ${agent.role}`}
              >
                <AgentActivityFace
                  agentId={agent.id}
                  className="flex w-11 shrink-0 items-center justify-center font-mono text-[9px] font-bold"
                  color={moderatedAgentColor(agent.color)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center truncate text-sm font-medium">
                    <span className="truncate">{agent.name}</span>
                    <BotStatus agentId={agent.id} agentName={agent.name} />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {agent.role}
                  </span>
                </span>
                <WorkspaceStatusBadge scope={`agent.${agent.id}`} />
              </SidebarMenuButton>
              {!agent.builtIn && (
                <SidebarMenuAction
                  aria-label={`Delete ${agent.name}`}
                  disabled={deletingId === agent.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(agent.id, agent.name);
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
        <div className="mt-4 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
          <span>// GROUPS</span>
        </div>
        <CreateAgentGroupDialog />
        <SidebarMenu className="mt-1 gap-1">
          {groups.map((group) => (
            <SidebarMenuItem key={group.id}>
              <SidebarMenuButton
                isActive={group.id === activeGroup?.id}
                onClick={() => selectGroup(group.id)}
                className="h-10 rounded-sm"
                tooltip={`${group.name} — ${group.memberIds.length} agents`}
              >
                <UsersIcon className="size-4 text-primary" />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <WorkspaceStatusBadge scope={`group.${group.id}`} />
              </SidebarMenuButton>
              <EditAgentGroupDialog group={group} />
              <SidebarMenuAction
                aria-label={`Delete ${group.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`Are you sure you want to delete group "${group.name}"?`)) deleteGroup(group.id);
                }}
              >
                <Trash2Icon />
              </SidebarMenuAction>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
