import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import {
  CLI_OPTIONS,
  customModels,
  rememberCustomModel,
} from "@/agents/cli-options";
import {
  threadModelKey,
  useThreadModels,
} from "@/agents/thread-model-provider";
import { RuntimeIcon } from "@/agents/runtime-icon";
import { useAuiState } from "@assistant-ui/react";

export function ModelSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  const { activeAgent, updateAgentModel, updateAgentRuntime } = useAgents();
  const turnRunning = useAuiState((state) => state.thread.isRunning);
  const { activeThreadId, selections, setSelection } = useThreadModels();
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [installedRuntimeIds, setInstalledRuntimeIds] = useState<Set<string>>(
    new Set(),
  );
  const [runtimeBackends, setRuntimeBackends] = useState<AgentBackendData[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [rememberedModels, setRememberedModels] = useState<string[]>(() =>
    customModels(activeAgent.cli),
  );
  const menuRef = useRef<HTMLDivElement>(null);
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
        ? Array.from(new Set([
            selectedModel,
            ...(runtimeBackends.find((backend) => backend.id === selectedRuntime)?.models ?? []),
            ...rememberedModels,
          ])).filter((model) =>
            model.toLowerCase().includes(search.trim().toLowerCase()),
          )
        : [],
    [rememberedModels, runtimeBackends, search, selectedModel, selectedRuntime, selectedRuntimeInstalled],
  );
  const customModel = search.trim();
  const canAddCustomModel =
    selectedRuntimeInstalled &&
    customModel.length > 0 &&
    !models.some((model) => model.toLowerCase() === customModel.toLowerCase());

  useEffect(() => {
    setRememberedModels(customModels(selectedRuntime));
  }, [selectedRuntime]);

  useEffect(() => {
    let current = true;
    void window.desktopApi.agents
      .backends()
      .then((backends) => {
        if (current) {
          setRuntimeBackends(backends);
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

  useEffect(() => {
    if (turnRunning) onClose();
  }, [onClose, turnRunning]);

  useEffect(() => {
    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-model-menu-trigger="true"]')) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const selectModel = async (model: string) => {
    if (turnRunning) return;
    setUpdating(true);
    setError("");
    try {
      await updateAgentModel(activeAgent.id, model);
      setSelection(key, { cli: selectedRuntime, model });
      setRememberedModels(rememberCustomModel(selectedRuntime, model));
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not change model.",
      );
    } finally {
      setUpdating(false);
    }
  };

  const selectRuntime = async (cli: typeof activeAgent.cli) => {
    if (turnRunning) return;
    const option = CLI_OPTIONS.find((item) => item.id === cli);
    if (!option) return;
    const defaultModel =
      runtimeBackends.find((backend) => backend.id === cli)?.defaultModel ??
      option.defaultModel;
    setUpdating(true);
    setError("");
    try {
      await updateAgentRuntime(activeAgent.id, cli, defaultModel);
      setSelection(key, { cli, model: defaultModel });
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
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Choose runtime and model"
      className="fixed top-[60px] left-1/2 z-[70] grid h-[430px] w-[560px] -translate-x-1/2 grid-cols-[76px_1fr] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl"
    >
      <nav className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/60 bg-muted/25 px-2 py-3" aria-label="Installed runtimes">
        {availableRuntimes.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={option.id === selectedRuntime}
            disabled={updating || turnRunning}
            onClick={() => void selectRuntime(option.id)}
            className={`relative flex size-12 shrink-0 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 ${option.id === selectedRuntime ? "bg-accent ring-1 ring-border" : "hover:bg-muted"}`}
          >
            <RuntimeIcon runtime={option.id} className="size-8" />
            {option.id === selectedRuntime && <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-primary" />}
          </button>
        ))}
        {loadingRuntimes && <span className="mt-2 size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />}
      </nav>
      <section className="flex min-h-0 min-w-0 flex-col p-3">
        <div className="mb-3 flex items-start gap-3 px-1">
          {selectedRuntimeInstalled && <RuntimeIcon runtime={selectedRuntime} className="size-9" />}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {CLI_OPTIONS.find((option) => option.id === selectedRuntime)?.label ?? "Models"}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">Runtime for {activeAgent.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close model menu">
            <XIcon className="size-4" />
          </button>
        </div>
        <label className="mb-3 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-input bg-background px-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input value={search} disabled={turnRunning} onChange={(event) => setSearch(event.target.value)} placeholder="Search or enter a model" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60" autoFocus />
        </label>
        <p className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Available models</p>
        <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
          {canAddCustomModel && (
            <button
              type="button"
              disabled={updating || turnRunning}
              onClick={() => void selectModel(customModel)}
              className="rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-60"
            >
              Use custom model “{customModel}”
            </button>
          )}
          {models.map((model) => (
            <button
              key={model}
              type="button"
              disabled={updating || turnRunning}
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
              {availableRuntimes.length === 0 && !loadingRuntimes
                ? "No supported runtime is installed. Connect one in Settings → AI agents."
                : "No matching models"}
            </p>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </section>
    </div>
  );
}
