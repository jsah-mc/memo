import { useEffect, useMemo, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import { CLI_OPTIONS, modelOptions } from "@/agents/cli-options";
import {
  threadModelKey,
  useThreadModels,
} from "@/agents/thread-model-provider";

export function ModelSidebar() {
  const { activeAgent, updateAgentModel, updateAgentRuntime } = useAgents();
  const { activeThreadId, selections, setSelection } = useThreadModels();
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [installedRuntimeIds, setInstalledRuntimeIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const key = threadModelKey(activeAgent.id, activeThreadId);
  const saved = selections[key];
  const selectedRuntime = saved?.cli ?? activeAgent.cli;
  const selectedModel = saved?.model ?? activeAgent.model;
  const availableRuntimes = useMemo(
    () => CLI_OPTIONS.filter((option) => installedRuntimeIds.has(option.id)),
    [installedRuntimeIds],
  );
  const selectedRuntimeInstalled = installedRuntimeIds.has(selectedRuntime);
  const models = useMemo(
    () =>
      selectedRuntimeInstalled
        ? modelOptions(selectedRuntime, selectedModel).filter((model) =>
            model.toLowerCase().includes(search.trim().toLowerCase()),
          )
        : [],
    [search, selectedModel, selectedRuntime, selectedRuntimeInstalled],
  );

  useEffect(() => {
    let current = true;
    void window.desktopApi.agents
      .backends()
      .then((backends) => {
        if (current) {
          setInstalledRuntimeIds(
            new Set(
              backends
                .filter((backend) => backend.installed)
                .map((backend) => backend.id),
            ),
          );
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not detect installed runtimes.",
          );
        }
      })
      .finally(() => {
        if (current) setLoadingRuntimes(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const selectModel = async (model: string) => {
    setUpdating(true);
    setError("");
    try {
      await updateAgentModel(activeAgent.id, model);
      setSelection(key, { cli: selectedRuntime, model });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not change model.",
      );
    } finally {
      setUpdating(false);
    }
  };

  const selectRuntime = async (cli: typeof activeAgent.cli) => {
    const option = CLI_OPTIONS.find((item) => item.id === cli);
    if (!option) return;
    setUpdating(true);
    setError("");
    try {
      await updateAgentRuntime(activeAgent.id, cli, option.defaultModel);
      setSelection(key, { cli, model: option.defaultModel });
      setSearch("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not change runtime.",
      );
    } finally {
      setUpdating(false);
    }
  };

  return (
    <aside className="h-full w-[380px] shrink-0 overflow-y-auto border-l border-border/60 bg-background/95 pt-14 backdrop-blur-xl">
      <div className="grid gap-3 p-3">
        <p className="px-1 text-[11px] text-muted-foreground">
          Changes apply immediately to {activeAgent.name} in every conversation.
        </p>
        <label className="grid gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          Runtime for {activeAgent.name}
          <select
            value={selectedRuntimeInstalled ? selectedRuntime : ""}
            disabled={updating || loadingRuntimes || availableRuntimes.length === 0}
            onChange={(event) =>
              void selectRuntime(event.target.value as typeof activeAgent.cli)
            }
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm font-medium text-foreground outline-none focus-visible:border-ring"
            aria-label={`Runtime for ${activeAgent.name}`}
          >
            {!selectedRuntimeInstalled && (
              <option value="" disabled>
                {loadingRuntimes
                  ? "Detecting installed CLIs…"
                  : "Select an installed CLI"}
              </option>
            )}
            {availableRuntimes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span>
            {availableRuntimes.length === 0 && !loadingRuntimes
              ? "No supported agent CLI is installed. Connect one in Settings → AI agents."
              : "Only installed agent CLIs are shown."}
          </span>
        </label>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search models"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <p className="px-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Available models
        </p>
        <div className="grid gap-1">
          {models.map((model) => (
            <button
              key={model}
              type="button"
              disabled={updating}
              onClick={() => void selectModel(model)}
              className="flex items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">{model}</span>
              {model === selectedModel && (
                <CheckIcon className="size-4 text-primary" />
              )}
            </button>
          ))}
          {models.length === 0 && (
            <p className="py-5 text-center text-xs text-muted-foreground">
              No matching models
            </p>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </aside>
  );
}
