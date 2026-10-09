import { useMemo, useState } from "react";
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
  const key = threadModelKey(activeAgent.id, activeThreadId);
  const saved = selections[key];
  const selectedRuntime = saved?.cli ?? activeAgent.cli;
  const selectedModel = saved?.model ?? activeAgent.model;
  const models = useMemo(
    () =>
      modelOptions(selectedRuntime, selectedModel).filter((model) =>
        model.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [search, selectedModel, selectedRuntime],
  );

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
            value={selectedRuntime}
            disabled={updating}
            onChange={(event) =>
              void selectRuntime(event.target.value as typeof activeAgent.cli)
            }
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm font-medium text-foreground outline-none focus-visible:border-ring"
            aria-label={`Runtime for ${activeAgent.name}`}
          >
            {CLI_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span>
            Changing runtime immediately selects its default model.
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
