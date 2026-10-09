import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function AiAgentsPanel() {
  const [backends, setBackends] = useState<AgentBackendData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setBackends(await window.desktopApi.agents.backends());
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load AI agents.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Connect AI agents</h3>
          <p className="text-xs text-muted-foreground">
            Memo detects installed runtimes and makes them available when
            creating agents.
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh AI agents"
        >
          <RefreshCwIcon
            className={`size-4 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {backends.map((backend) => (
          <div
            key={backend.id}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
          >
            {backend.installed ? (
              <CheckCircle2Icon className="size-5 shrink-0 text-primary" />
            ) : (
              <CircleDashedIcon className="size-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{backend.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {backend.installed
                  ? `Connected · ${backend.executable}`
                  : `Install ${backend.executable} to connect`}
              </p>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
