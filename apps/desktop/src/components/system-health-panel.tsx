import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Health = Awaited<ReturnType<typeof window.desktopApi.getSystemHealth>>;

function StatusRow({
  label,
  value,
  healthy,
}: Readonly<{ label: string; value: string; healthy: boolean }>) {
  const Icon = healthy ? CheckCircle2Icon : CircleAlertIcon;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        <Icon
          className={`size-3.5 ${healthy ? "text-primary" : "text-destructive"}`}
        />
        {value}
      </span>
    </div>
  );
}

export function SystemHealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await window.desktopApi.getSystemHealth());
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Health check failed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const providerReady = health?.provider.status === "ready";
  return (
    <section
      className="grid gap-3 rounded-xl bg-muted/35 p-3"
      aria-labelledby="system-health-title"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p id="system-health-title" className="text-sm font-medium">
            System health
          </p>
          <p className="text-xs text-muted-foreground">
            Gateway and model-provider readiness.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh system health"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon
            className={`size-4 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
      {health && (
        <div className="grid gap-2">
          <StatusRow
            label="Gateway"
            value={`Online · ${health.latency_ms} ms`}
            healthy={health.gateway.status === "ok"}
          />
          <StatusRow
            label="Codex"
            value={providerReady ? "Signed in" : health.provider.status}
            healthy={providerReady}
          />
          {!providerReady && (
            <div className="grid gap-2 rounded-lg bg-destructive/10 p-2.5">
              <p className="text-xs text-destructive">
                {health.provider.message}
              </p>
              <p className="text-xs text-muted-foreground">
                Run <code>codex login</code> in a terminal, then refresh this
                check.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void window.desktopApi.openCodexHelp()}
              >
                Open sign-in help <ExternalLinkIcon className="size-3" />
              </Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
