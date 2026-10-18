import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAgents } from "@/agents/agent-provider";

export type AgentGroup = Readonly<{
  id: string;
  name: string;
  memberIds: readonly string[];
}>;

type AgentGroupContextValue = Readonly<{
  groups: readonly AgentGroup[];
  activeGroup: AgentGroup | null;
  createGroup: (name: string, memberIds: readonly string[]) => void;
  deleteGroup: (id: string) => void;
  selectGroup: (id: string) => void;
  clearActiveGroup: () => void;
}>;

const STORAGE_KEY = "memo.agent-groups.v1";
const ACTIVE_KEY = "memo.active-agent-group.v1";
const AgentGroupContext = createContext<AgentGroupContextValue | null>(null);

const loadGroups = (): AgentGroup[] => {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is AgentGroup => {
      if (!value || typeof value !== "object") return false;
      const group = value as Record<string, unknown>;
      return (
        typeof group.id === "string" &&
        typeof group.name === "string" &&
        Array.isArray(group.memberIds) &&
        group.memberIds.every((id) => typeof id === "string")
      );
    });
  } catch {
    return [];
  }
};

export function AgentGroupProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { agents, selectAgent } = useAgents();
  const [groups, setGroups] = useState(loadGroups);
  const [activeGroupId, setActiveGroupId] = useState(
    () => window.localStorage.getItem(ACTIVE_KEY) ?? "",
  );
  const validAgentIds = useMemo(() => new Set(agents.map(({ id }) => id)), [agents]);
  const activeGroup =
    groups.find(
      (group) =>
        group.id === activeGroupId &&
        group.memberIds.some((id) => validAgentIds.has(id)),
    ) ?? null;

  const persist = useCallback((next: readonly AgentGroup[]) => {
    setGroups([...next]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const createGroup = useCallback(
    (name: string, memberIds: readonly string[]) => {
      const members = [...new Set(memberIds)].filter((id) => validAgentIds.has(id));
      if (members.length < 2) throw new Error("Choose at least two agents.");
      const group: AgentGroup = {
        id: crypto.randomUUID(),
        name: name.trim() || "Agent group",
        memberIds: members,
      };
      persist([...groups, group]);
      setActiveGroupId(group.id);
      window.localStorage.setItem(ACTIVE_KEY, group.id);
      selectAgent(members[0]);
    },
    [groups, persist, selectAgent, validAgentIds],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      persist(groups.filter((group) => group.id !== id));
      if (activeGroupId === id) {
        setActiveGroupId("");
        window.localStorage.removeItem(ACTIVE_KEY);
      }
    },
    [activeGroupId, groups, persist],
  );

  const selectGroup = useCallback(
    (id: string) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return;
      const firstMember = group.memberIds.find((memberId) => validAgentIds.has(memberId));
      if (firstMember) selectAgent(firstMember);
      setActiveGroupId(id);
      window.localStorage.setItem(ACTIVE_KEY, id);
    },
    [groups, selectAgent, validAgentIds],
  );

  const clearActiveGroup = useCallback(() => {
    setActiveGroupId("");
    window.localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const value = useMemo(
    () => ({ groups, activeGroup, createGroup, deleteGroup, selectGroup, clearActiveGroup }),
    [activeGroup, clearActiveGroup, createGroup, deleteGroup, groups, selectGroup],
  );

  return <AgentGroupContext.Provider value={value}>{children}</AgentGroupContext.Provider>;
}

export function useAgentGroups(): AgentGroupContextValue {
  const value = useContext(AgentGroupContext);
  if (!value) throw new Error("useAgentGroups requires AgentGroupProvider.");
  return value;
}
