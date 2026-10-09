import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CLIBackendId } from "@/agents/cli-options";

const STORAGE_KEY = "memo.thread-agent-models.v2";

export type ThreadModelSelection = Readonly<{
  cli: CLIBackendId;
  model: string;
}>;

function loadSelections(): Record<string, ThreadModelSelection> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, ThreadModelSelection] => {
          const selection = entry[1];
          return (
            Boolean(selection) &&
            typeof selection === "object" &&
            "cli" in selection &&
            typeof selection.cli === "string" &&
            "model" in selection &&
            typeof selection.model === "string"
          );
        },
      ),
    );
  } catch {
    return {};
  }
}

type ThreadModelContextValue = Readonly<{
  activeThreadId: string;
  selections: Readonly<Record<string, ThreadModelSelection>>;
  setActiveThreadId: (threadId: string) => void;
  setSelection: (key: string, selection: ThreadModelSelection) => void;
}>;

const ThreadModelContext = createContext<ThreadModelContextValue | null>(null);

export const threadModelKey = (agentId: string, threadId: string) =>
  `${agentId}:${threadId}`;

export function ThreadModelProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [activeThreadId, setActiveThreadId] = useState("");
  const [selections, setSelections] = useState(loadSelections);
  const setSelection = useCallback(
    (key: string, selection: ThreadModelSelection) => {
      if (!key) return;
      setSelections((current) => {
        const next = { ...current, [key]: selection };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );
  const value = useMemo(
    () => ({ activeThreadId, selections, setActiveThreadId, setSelection }),
    [activeThreadId, selections, setSelection],
  );
  return (
    <ThreadModelContext.Provider value={value}>
      {children}
    </ThreadModelContext.Provider>
  );
}

export function useThreadModels() {
  const value = useContext(ThreadModelContext);
  if (!value) throw new Error("useThreadModels requires ThreadModelProvider.");
  return value;
}
