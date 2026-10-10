import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarClockIcon,
  CalendarPlusIcon,
  CloudIcon,
  LoaderCircleIcon,
  MonitorIcon,
  MonitorUpIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useAgents, type AgentProfile } from "@/agents/agent-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Routine = Readonly<{
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  cadence: "daily" | "weekdays" | "weekly";
  time: string;
  enabled: boolean;
  createdAt: string;
}>;

const ROUTINES_KEY = "memo.agent-routines.v1";

function loadRoutines(): Routine[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(ROUTINES_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (item): item is Routine =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof item.id === "string" &&
            typeof item.agentId === "string" &&
            typeof item.name === "string" &&
            typeof item.prompt === "string" &&
            ["daily", "weekdays", "weekly"].includes(item.cadence) &&
            typeof item.time === "string" &&
            typeof item.enabled === "boolean",
        )
      : [];
  } catch {
    return [];
  }
}

function nextRun(routine: Routine) {
  const [hours, minutes] = routine.time.split(":").map(Number);
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hours, minutes, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  if (routine.cadence === "weekdays") {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  }
  if (routine.cadence === "weekly") {
    while (next.getDay() !== 1) next.setDate(next.getDate() + 1);
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(next);
}

export function AgentDesktopPanel({
  agent,
}: Readonly<{
  agent: AgentProfile;
}>) {
  const { updateAgentComputer } = useAgents();
  const [routines, setRoutines] = useState(loadRoutines);
  const [showRoutineForm, setShowRoutineForm] = useState(false);
  const [switchingComputer, setSwitchingComputer] = useState(false);
  const [computerError, setComputerError] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<Routine["cadence"]>("daily");
  const [time, setTime] = useState("09:00");
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  const agentRoutines = useMemo(
    () => routines.filter((routine) => routine.agentId === agent?.id),
    [agent?.id, routines],
  );

  const persist = useCallback((next: Routine[]) => {
    setRoutines(next);
    localStorage.setItem(ROUTINES_KEY, JSON.stringify(next));
  }, []);

  const refreshPreview = useCallback(async () => {
    setLoadingPreview(true);
    setPreviewError("");
    try {
      const result = await window.desktopApi.virtualDesktop.preview(
        agent.computerTarget === "vps" ? "vps" : "local_vm",
      );
      setPreview(result.image);
    } catch (reason) {
      setPreview("");
      setPreviewError(
        reason instanceof Error
          ? reason.message
          : "Could not preview the shared VM.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, [agent]);

  useEffect(() => {
    if (agent.computerTarget !== "host") void refreshPreview();
    else {
      setPreview("");
      setPreviewError("");
    }
  }, [agent.computerTarget, refreshPreview]);

  const chooseComputer = async (target: "host" | "local_vm" | "vps") => {
    setSwitchingComputer(true);
    setComputerError("");
    try {
      await updateAgentComputer(agent.id, target);
    } catch (reason) {
      setComputerError(
        reason instanceof Error
          ? reason.message
          : "Could not update this agent.",
      );
    } finally {
      setSwitchingComputer(false);
    }
  };

  const addRoutine = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    persist([
      ...routines,
      {
        id: crypto.randomUUID(),
        agentId: agent.id,
        name: name.trim(),
        prompt: prompt.trim(),
        cadence,
        time,
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    setName("");
    setPrompt("");
    setShowRoutineForm(false);
  };

  return (
    <aside className="h-full w-[360px] shrink-0 overflow-y-auto border-l border-border/60 bg-background/95 pt-14 backdrop-blur-xl">
      <div className="grid gap-4 p-3">
        <section className="grid grid-cols-4 gap-2" aria-label="Agent actions">
          <button
            type="button"
            disabled={switchingComputer}
            aria-pressed={agent.computerTarget === "host"}
            onClick={() => void chooseComputer("host")}
            className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-xs transition-colors ${
              agent.computerTarget === "host"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 bg-muted/25 hover:bg-muted/50"
            }`}
          >
            <MonitorIcon className="size-5" />
            <span>Desktop</span>
          </button>
          <button
            type="button"
            disabled={switchingComputer}
            aria-pressed={agent.computerTarget === "local_vm"}
            onClick={() => void chooseComputer("local_vm")}
            className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-xs transition-colors ${
              agent.computerTarget === "local_vm"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 bg-muted/25 hover:bg-muted/50"
            }`}
          >
            {switchingComputer ? (
              <LoaderCircleIcon className="size-5 animate-spin" />
            ) : (
              <PackageIcon className="size-5" />
            )}
            <span>Local VM</span>
          </button>
          <button
            type="button"
            disabled={switchingComputer}
            aria-pressed={agent.computerTarget === "vps"}
            onClick={() => void chooseComputer("vps")}
            className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-xs transition-colors ${
              agent.computerTarget === "vps"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 bg-muted/25 hover:bg-muted/50"
            }`}
          >
            <CloudIcon className="size-5" />
            <span>VPS</span>
          </button>
          <button
            type="button"
            aria-expanded={showRoutineForm}
            onClick={() => setShowRoutineForm((value) => !value)}
            className={`grid min-h-20 place-items-center gap-1 rounded-xl border p-2 text-xs transition-colors ${
              showRoutineForm
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 bg-muted/25 hover:bg-muted/50"
            }`}
          >
            <CalendarPlusIcon className="size-5" />
            <span>Add routine</span>
          </button>
        </section>

        {computerError && (
          <p role="alert" className="text-xs text-destructive">
            {computerError}
          </p>
        )}

        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Desktop preview</p>
              <p className="text-xs text-muted-foreground">
                {agent.computerTarget === "local_vm"
                  ? "Local VM on this computer"
                  : agent.computerTarget === "vps"
                    ? "Remote VPS"
                    : "This agent uses your computer"}
              </p>
            </div>
            {agent.computerTarget !== "host" && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={loadingPreview}
                onClick={() => void refreshPreview()}
                aria-label="Refresh desktop preview"
              >
                {loadingPreview ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RefreshCwIcon />
                )}
              </Button>
            )}
          </div>
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-black/80">
            {preview ? (
              <img
                src={preview}
                alt="Shared virtual desktop"
                className="size-full object-contain"
              />
            ) : (
              <div className="grid justify-items-center gap-2 px-6 text-center text-xs text-muted-foreground">
                <MonitorUpIcon className="size-6" />
                <span>
                  {previewError ||
                    (agent.computerTarget !== "host"
                      ? `Connect the ${agent.computerTarget === "vps" ? "VPS" : "Local VM"} to see a preview.`
                      : "Host preview stays hidden until the agent requests access.")}
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <p className="text-sm font-medium">Routines</p>
            <p className="text-xs text-muted-foreground">
              Schedules are saved separately for {agent.name}.
            </p>
          </div>

          {showRoutineForm && (
            <form
              className="grid gap-2 rounded-xl bg-muted/35 p-3"
              onSubmit={addRoutine}
            >
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Routine name"
                required
              />
              <textarea
                className="min-h-20 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What should this agent do?"
                required
              />
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <select
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                  value={cadence}
                  onChange={(event) =>
                    setCadence(event.target.value as Routine["cadence"])
                  }
                >
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Every Monday</option>
                </select>
                <Input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" size="sm">
                <PlusIcon /> Schedule routine
              </Button>
            </form>
          )}

          <div className="grid gap-2">
            {agentRoutines.map((routine) => (
              <div
                key={routine.id}
                className="grid gap-1 rounded-xl border border-border/60 p-3"
              >
                <div className="flex items-start gap-2">
                  <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {routine.name}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {routine.prompt}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${routine.name}`}
                    onClick={() =>
                      persist(routines.filter((item) => item.id !== routine.id))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="flex items-center justify-between pl-6 text-xs text-muted-foreground">
                  <span>Next {nextRun(routine)}</span>
                  <button
                    type="button"
                    className={
                      routine.enabled ? "text-primary" : "text-muted-foreground"
                    }
                    onClick={() =>
                      persist(
                        routines.map((item) =>
                          item.id === routine.id
                            ? { ...item, enabled: !item.enabled }
                            : item,
                        ),
                      )
                    }
                  >
                    {routine.enabled ? "On" : "Off"}
                  </button>
                </div>
              </div>
            ))}
            {agentRoutines.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No routines scheduled.
              </p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
