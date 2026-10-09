import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  MonitorIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/agents/agent-provider";
import { AgentActivityFace } from "@/agents/agent-activity";
import { useAuiState } from "@assistant-ui/react";
import {
  threadModelKey,
  useThreadModels,
} from "@/agents/thread-model-provider";
import { CLI_OPTIONS, modelOptions } from "@/agents/cli-options";

export function LegacyModelPicker() {
  const { activeAgent, updateAgentModel } = useAgents();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedModel = activeAgent.model;
  const provider =
    CLI_OPTIONS.find((option) => option.id === activeAgent.cli)?.label ??
    activeAgent.cli;
  const models = useMemo(
    () =>
      modelOptions(activeAgent.cli, selectedModel).filter((model) =>
        model.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [activeAgent.cli, search, selectedModel],
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selectModel = async (model: string) => {
    setUpdating(true);
    setError("");
    try {
      await updateAgentModel(activeAgent.id, model);
      setOpen(false);
      setSearch("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not change model.",
      );
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-9 w-44 items-center gap-2 rounded-full border border-border/60 bg-card/65 px-3 text-xs shadow-sm outline-none hover:bg-card focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedModel}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Select model"
          className="absolute top-11 left-1/2 z-50 w-[380px] -translate-x-1/2 rounded-2xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-2xl"
        >
          <p className="px-1 pt-2 pb-3 text-[11px] text-muted-foreground">
            Changes apply immediately to {activeAgent.name} in every conversation.
          </p>
          <div className="mb-3 rounded-xl border border-border/60 bg-muted/20 p-3">
            <p className="text-sm font-semibold">{provider}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Runtime for {activeAgent.name}
            </p>
          </div>
          <label className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </label>
          <p className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Available models
          </p>
          <div className="grid max-h-64 gap-1 overflow-y-auto">
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
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ModelSidebarButton({
  open,
  onToggle,
}: Readonly<{ open: boolean; onToggle: () => void }>) {
  const { activeAgent } = useAgents();
  const threadId = useAuiState((state) => state.threads.mainThreadId);
  const { selections, setActiveThreadId, setSelection } = useThreadModels();
  const key = threadModelKey(activeAgent.id, threadId);
  const saved = selections[key];
  const model = saved?.model ?? activeAgent.model;
  useEffect(() => {
    setActiveThreadId(threadId);
    if (threadId && !saved) {
      setSelection(key, { cli: activeAgent.cli, model: activeAgent.model });
    }
  }, [activeAgent.cli, activeAgent.model, key, saved, setActiveThreadId, setSelection, threadId]);
  return (
    <button
      type="button"
      className={`flex h-9 w-44 items-center gap-2 rounded-full border px-3 text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${open ? "border-primary bg-primary/10" : "border-border/60 bg-card/65 hover:bg-card"}`}
      aria-label={open ? "Close model sidebar" : "Open model sidebar"}
      aria-pressed={open}
      onClick={onToggle}
    >
      <span className="min-w-0 flex-1 truncate text-left">{model}</span>
      <ChevronDownIcon
        className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

export default function Titlebar({
  desktopOpen = false,
  modelOpen = false,
  onDesktopToggle,
  onModelToggle,
}: Readonly<{
  desktopOpen?: boolean;
  modelOpen?: boolean;
  onDesktopToggle?: () => void;
  onModelToggle?: () => void;
}>) {
  const { activeAgent } = useAgents();
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.desktopApi
        .getGatewayStatus()
        .then((status) => {
          if (!cancelled) setOnline(status.state === "online");
        })
        .catch(() => {
          if (!cancelled) setOnline(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <header className="liquid-titlebar drag fixed top-0 right-0 left-72 z-50 flex h-14 items-center justify-center px-36 text-foreground">
      <div className="no-drag flex items-center gap-2">
        <div className="agent-title-pill flex h-9 w-44 min-w-0 items-center gap-2 rounded-full border border-border/60 bg-card/65 pr-3 pl-1.5 shadow-sm">
          <AgentActivityFace
            agentId={activeAgent.id}
            className="flex size-7 shrink-0 items-center justify-center font-mono text-xs font-bold text-primary"
          />
          <span className="min-w-0">
            <span className="block max-w-40 truncate text-xs font-semibold">
              {activeAgent.name}
            </span>
          </span>
          <span
            className={`size-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`}
            aria-label={online ? "Gateway ready" : "Gateway connecting"}
          />
        </div>
        {onModelToggle ? (
          <ModelSidebarButton open={modelOpen} onToggle={onModelToggle} />
        ) : (
          <span className="flex h-9 w-44 items-center truncate rounded-full border border-border/60 bg-card/65 px-3 text-xs text-muted-foreground shadow-sm">
            {activeAgent.model}
          </span>
        )}
        {onDesktopToggle && (
          <Button
            type="button"
            size="icon"
            variant={desktopOpen ? "secondary" : "outline"}
            className="rounded-full bg-card/65"
            aria-label={
              desktopOpen ? "Close desktop panel" : "Open desktop panel"
            }
            aria-pressed={desktopOpen}
            onClick={onDesktopToggle}
          >
            <MonitorIcon />
          </Button>
        )}
      </div>
      {window.desktopApi.platform !== "darwin" && (
        <div className="no-drag absolute top-0 right-0 flex h-10">
          <button
            className="flex w-12 items-center justify-center hover:bg-white/10"
            aria-label="Minimize"
            onClick={() => window.desktopApi.windowControls.minimize()}
          >
            <MinusIcon className="size-4" />
          </button>
          <button
            className="flex w-12 items-center justify-center hover:bg-white/10"
            aria-label="Maximize or restore"
            onClick={() => window.desktopApi.windowControls.toggleMaximize()}
          >
            <SquareIcon className="size-3.5" />
          </button>
          <button
            className="flex w-12 items-center justify-center hover:bg-red-600"
            aria-label="Close"
            onClick={() => window.desktopApi.windowControls.close()}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}
    </header>
  );
}
