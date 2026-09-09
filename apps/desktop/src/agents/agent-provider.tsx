import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { CLIBackendId } from "@/agents/cli-options";

export type AgentProfile = Readonly<{
  id: string;
  name: string;
  role: string;
  instructions: string;
  cli: CLIBackendId;
  model: string;
  composioEnabled: boolean;
  composioUserId: string;
  composioToolkits: readonly string[];
  color: string;
  builtIn?: boolean;
}>;

type NewAgent = Readonly<Omit<AgentProfile, "id" | "builtIn">>;

type AgentContextValue = Readonly<{
  agents: readonly AgentProfile[];
  activeAgent: AgentProfile;
  selectAgent: (id: string) => void;
  createAgent: (agent: NewAgent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}>;

const DEFAULT_AGENT: AgentProfile = {
  id: "memo",
  name: "Memo",
  role: "General assistant",
  instructions:
    "You are Memo, a capable general assistant. Be concise, practical, and transparent.",
  cli: "codex",
  model: "gpt-5.6-luna",
  composioEnabled: false,
  composioUserId: "",
  composioToolkits: [],
  color: "var(--primary)",
  builtIn: true,
};

const STORAGE_KEY = "memo.agent-profiles.v1";
const ACTIVE_KEY = "memo.active-agent.v1";
const AgentContext = createContext<AgentContextValue | null>(null);

const isAgentProfile = (value: unknown): value is AgentProfile => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.role === "string" &&
    typeof record.instructions === "string" &&
    typeof record.cli === "string" &&
    typeof record.model === "string" &&
    typeof record.composioEnabled === "boolean" &&
    typeof record.composioUserId === "string" &&
    Array.isArray(record.composioToolkits) &&
    typeof record.color === "string"
  );
};

const migrateAgent = (value: unknown): AgentProfile | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const migrated = {
    ...record,
    cli: typeof record.cli === "string" ? record.cli : "codex",
    model: typeof record.model === "string" ? record.model : "gpt-5.6-luna",
    composioEnabled: typeof record.composioEnabled === "boolean" ? record.composioEnabled : false,
    composioUserId: typeof record.composioUserId === "string" ? record.composioUserId : "",
    composioToolkits: Array.isArray(record.composioToolkits) ? record.composioToolkits : [],
  };
  return isAgentProfile(migrated) ? migrated : null;
};

const loadAgents = (): readonly AgentProfile[] => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [DEFAULT_AGENT];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [DEFAULT_AGENT];
    return [DEFAULT_AGENT, ...parsed.map(migrateAgent).filter((a): a is AgentProfile => a !== null).filter((a) => a.id !== DEFAULT_AGENT.id)];
  } catch {
    return [DEFAULT_AGENT];
  }
};

export function AgentProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [agents, setAgents] = useState(loadAgents);
  const [activeId, setActiveId] = useState(
    () => window.localStorage.getItem(ACTIVE_KEY) ?? DEFAULT_AGENT.id,
  );
  const activeAgent =
    agents.find((agent) => agent.id === activeId) ?? DEFAULT_AGENT;

  const persist = useCallback((profiles: readonly AgentProfile[]) => {
    setAgents(profiles);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(profiles.filter((agent) => !agent.builtIn)),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cached = agents.filter((agent) => !agent.builtIn);
    void window.desktopApi.agents.list().then(async (profiles) => {
      const loaded = profiles.map(migrateAgent).filter((agent): agent is AgentProfile => agent !== null);
      const serverIds = new Set(loaded.map((agent) => agent.id));
      const missing = cached.filter((agent) => !serverIds.has(agent.id));
      const migrated = await Promise.all(
        missing.map((agent) => window.desktopApi.agents.create(agent).then(migrateAgent)),
      );
      if (cancelled) return;
      const combined = [...loaded, ...migrated.filter((agent): agent is AgentProfile => agent !== null)];
      if (combined.length) persist(combined);
    }).catch(() => {
      // Keep the local cache while the gateway starts or is unavailable.
    });
    return () => { cancelled = true; };
  }, [persist]);

  const selectAgent = useCallback((id: string) => {
    setActiveId(id);
    window.localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const createAgent = useCallback(
    async (agent: NewAgent) => {
      const created = migrateAgent(await window.desktopApi.agents.create(agent));
      if (!created) throw new Error("The gateway returned an invalid agent.");
      persist([...agents.filter((item) => item.id !== created.id), created]);
      selectAgent(created.id);
    },
    [agents, persist, selectAgent],
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      const profile = agents.find((agent) => agent.id === id);
      if (!profile || profile.builtIn) return;
      await window.desktopApi.agents.delete(id);
      persist(agents.filter((agent) => agent.id !== id));
      if (activeId === id) selectAgent(DEFAULT_AGENT.id);
    },
    [activeId, agents, persist, selectAgent],
  );

  const value = useMemo(
    () => ({ agents, activeAgent, selectAgent, createAgent, deleteAgent }),
    [agents, activeAgent, selectAgent, createAgent, deleteAgent],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgents(): AgentContextValue {
  const context = useContext(AgentContext);
  if (!context) throw new Error("useAgents must be used within AgentProvider.");
  return context;
}
