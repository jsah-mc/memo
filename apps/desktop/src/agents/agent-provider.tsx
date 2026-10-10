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
  description: string;
  style: string;
  soul: string;
  cli: CLIBackendId;
  model: string;
  composioEnabled: boolean;
  composioUserId: string;
  composioToolkits: readonly string[];
  computerTarget: "host" | "local_vm" | "vps";
  color: string;
  builtIn?: boolean;
}>;

type NewAgent = Readonly<Omit<AgentProfile, "id" | "builtIn">>;

type AgentContextValue = Readonly<{
  agents: readonly AgentProfile[];
  loaded: boolean;
  loadError: string;
  reload: () => void;
  activeAgent: AgentProfile;
  selectAgent: (id: string) => void;
  createAgent: (agent: NewAgent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  updateAgentComputer: (
    id: string,
    computerTarget: "host" | "local_vm" | "vps",
  ) => Promise<void>;
  updateAgentModel: (id: string, model: string) => Promise<void>;
  updateAgentRuntime: (
    id: string,
    cli: CLIBackendId,
    model: string,
  ) => Promise<void>;
}>;

const DEFAULT_AGENT: AgentProfile = {
  id: "memo",
  name: "Memo",
  role: "General assistant",
  instructions:
    "You are Memo, a capable general assistant. Be concise, practical, and transparent.",
  description: "A practical general assistant.",
  style: "balanced",
  soul: "Be thoughtful, honest, and curious.",
  cli: "codex",
  model: "gpt-5.6-luna",
  composioEnabled: false,
  composioUserId: "",
  composioToolkits: [],
  computerTarget: "host",
  color: "var(--primary)",
  builtIn: true,
};

const STORAGE_KEY = "memo.agent-profiles.v1";
const MIGRATED_KEY = "memo.agent-profiles.gateway-migrated.v1";
const ACTIVE_KEY = "memo.active-agent.v1";
const BUILTIN_COMPUTER_KEY = "memo.builtin-computer.v1";
const BUILTIN_MODEL_KEY = "memo.builtin-model.v1";
const BUILTIN_CLI_KEY = "memo.builtin-cli.v1";
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
    (["host", "local_vm", "vps"] as const).includes(
      record.computerTarget as "host" | "local_vm" | "vps",
    ) &&
    typeof record.color === "string"
  );
};

const migrateAgent = (value: unknown): AgentProfile | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const migrated = {
    ...record,
    description:
      typeof record.description === "string"
        ? record.description
        : String(record.role ?? "Assistant"),
    style: typeof record.style === "string" ? record.style : "balanced",
    soul:
      typeof record.soul === "string"
        ? record.soul
        : String(record.instructions ?? "Be helpful and honest."),
    cli: typeof record.cli === "string" ? record.cli : "codex",
    model: typeof record.model === "string" ? record.model : "gpt-5.6-luna",
    composioEnabled:
      typeof record.composioEnabled === "boolean"
        ? record.composioEnabled
        : false,
    composioUserId:
      typeof record.composioUserId === "string" ? record.composioUserId : "",
    composioToolkits: Array.isArray(record.composioToolkits)
      ? record.composioToolkits
      : [],
    computerTarget:
      record.computerTarget === "virtual"
        ? "local_vm"
        : ["local_vm", "vps"].includes(String(record.computerTarget))
          ? record.computerTarget
          : "host",
  };
  return isAgentProfile(migrated) ? migrated : null;
};

const loadAgents = (): readonly AgentProfile[] => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(migrateAgent)
      .filter((a): a is AgentProfile => a !== null && !a.builtIn);
  } catch {
    return [];
  }
};

export function AgentProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [agents, setAgents] = useState(loadAgents);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    setLoaded(false);
    setLoadError("");
    setRevision((value) => value + 1);
  }, []);
  const [activeId, setActiveId] = useState(
    () => window.localStorage.getItem(ACTIVE_KEY) ?? DEFAULT_AGENT.id,
  );
  const [builtInComputer, setBuiltInComputer] = useState<
    "host" | "local_vm" | "vps"
  >(() => {
    const saved = window.localStorage.getItem(BUILTIN_COMPUTER_KEY);
    if (saved === "virtual") return "local_vm";
    return saved === "local_vm" || saved === "vps" ? saved : "host";
  });
  const [builtInModel, setBuiltInModel] = useState(
    () => window.localStorage.getItem(BUILTIN_MODEL_KEY) ?? DEFAULT_AGENT.model,
  );
  const [builtInCli, setBuiltInCli] = useState<CLIBackendId>(() => {
    const saved = window.localStorage.getItem(BUILTIN_CLI_KEY);
    return saved &&
      [
        "codex",
        "claude",
        "antigravity",
        "opencode",
        "ollama",
        "lmstudio",
        "grok-build",
        "cursor",
        "hermes",
        "pi",
      ].includes(saved)
      ? (saved as CLIBackendId)
      : DEFAULT_AGENT.cli;
  });
  const builtInAgent = {
    ...DEFAULT_AGENT,
    computerTarget: builtInComputer,
    model: builtInModel,
    cli: builtInCli,
  };
  const activeAgent =
    agents.find((agent) => agent.id === activeId) ?? agents[0] ?? builtInAgent;

  const persist = useCallback((profiles: readonly AgentProfile[]) => {
    setAgents(profiles);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(profiles.filter((agent) => !agent.builtIn)),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!window.desktopApi?.agents) {
      setLoadError("Open Memo in the desktop app to load and create agents.");
      return;
    }
    const cached = window.localStorage.getItem(MIGRATED_KEY)
      ? []
      : agents.filter((agent) => !agent.builtIn);
    void window.desktopApi.agents
      .list()
      .then(async (profiles) => {
        const loaded = profiles
          .map(migrateAgent)
          .filter(
            (agent): agent is AgentProfile => agent !== null && !agent.builtIn,
          );
        const serverIds = new Set(loaded.map((agent) => agent.id));
        const missing = cached.filter((agent) => !serverIds.has(agent.id));
        const migrated = await Promise.all(
          missing.map((agent) =>
            window.desktopApi.agents.create(agent).then(migrateAgent),
          ),
        );
        if (cancelled) return;
        const combined = [
          ...loaded,
          ...migrated.filter((agent): agent is AgentProfile => agent !== null),
        ];
        persist(combined);
        window.localStorage.setItem(MIGRATED_KEY, "1");
        setLoadError("");
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "Could not load your agents.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [persist, revision]);

  const selectAgent = useCallback((id: string) => {
    setActiveId(id);
    window.localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const createAgent = useCallback(
    async (agent: NewAgent) => {
      const created = migrateAgent(
        await window.desktopApi.agents.create(agent),
      );
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

  const updateAgentComputer = useCallback(
    async (id: string, computerTarget: "host" | "local_vm" | "vps") => {
      if (id === DEFAULT_AGENT.id) {
        setBuiltInComputer(computerTarget);
        window.localStorage.setItem(BUILTIN_COMPUTER_KEY, computerTarget);
        return;
      }
      const updated = migrateAgent(
        await window.desktopApi.agents.update(id, { computerTarget }),
      );
      if (!updated) throw new Error("The gateway returned an invalid agent.");
      persist(agents.map((agent) => (agent.id === id ? updated : agent)));
    },
    [agents, persist],
  );

  const updateAgentModel = useCallback(
    async (id: string, model: string) => {
      const value = model.trim();
      if (!value) throw new Error("Model must not be empty.");
      if (id === DEFAULT_AGENT.id) {
        setBuiltInModel(value);
        window.localStorage.setItem(BUILTIN_MODEL_KEY, value);
        return;
      }
      const updated = migrateAgent(
        await window.desktopApi.agents.update(id, { model: value }),
      );
      if (!updated) throw new Error("The gateway returned an invalid agent.");
      persist(agents.map((agent) => (agent.id === id ? updated : agent)));
    },
    [agents, persist],
  );

  const updateAgentRuntime = useCallback(
    async (id: string, cli: CLIBackendId, model: string) => {
      const value = model.trim();
      if (!value) throw new Error("Model must not be empty.");
      if (id === DEFAULT_AGENT.id) {
        setBuiltInCli(cli);
        setBuiltInModel(value);
        window.localStorage.setItem(BUILTIN_CLI_KEY, cli);
        window.localStorage.setItem(BUILTIN_MODEL_KEY, value);
        return;
      }
      const updated = migrateAgent(
        await window.desktopApi.agents.update(id, { cli, model: value }),
      );
      if (!updated) throw new Error("The gateway returned an invalid agent.");
      persist(agents.map((agent) => (agent.id === id ? updated : agent)));
    },
    [agents, persist],
  );

  const value = useMemo(
    () => ({
      agents,
      activeAgent,
      loaded,
      loadError,
      reload,
      selectAgent,
      createAgent,
      deleteAgent,
      updateAgentComputer,
      updateAgentModel,
      updateAgentRuntime,
    }),
    [
      agents,
      activeAgent,
      loaded,
      loadError,
      reload,
      selectAgent,
      createAgent,
      deleteAgent,
      updateAgentComputer,
      updateAgentModel,
      updateAgentRuntime,
    ],
  );

  return (
    <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
  );
}

export function useAgents(): AgentContextValue {
  const context = useContext(AgentContext);
  if (!context) throw new Error("useAgents must be used within AgentProvider.");
  return context;
}
