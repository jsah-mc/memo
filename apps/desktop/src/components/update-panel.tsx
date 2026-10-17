import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  RefreshCwIcon,
  TerminalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type UpdateStatus = Awaited<ReturnType<typeof window.desktopApi.updates.check>>;

export function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      setStatus(await window.desktopApi.updates.check());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Update check failed.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => void check(), [check]);

  const install = async () => {
    setInstalling(true);
    setError("");
    try {
      await window.desktopApi.updates.install();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Update failed.");
      setInstalling(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="terminal-card grid gap-4 border border-border p-4">
        <div className="flex items-start gap-3">
          {status && !status.available ? (
            <CheckCircle2Icon className="mt-0.5 size-5 text-primary" />
          ) : (
            <DownloadIcon className="mt-0.5 size-5 text-primary" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {checking
                ? "Checking for updates…"
                : status?.available
                  ? `Memo ${status.latestVersion} is available`
                  : "Memo is up to date"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Installed version: {status?.currentVersion ?? "detecting"}
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void check()}
            disabled={checking || installing}
            aria-label="Check for updates"
          >
            <RefreshCwIcon className={checking ? "animate-spin" : ""} />
          </Button>
        </div>

        {status?.available && (
          <Button type="button" onClick={() => void install()} disabled={installing}>
            <DownloadIcon />
            {installing ? "Updating…" : "Update and restart"}
          </Button>
        )}
      </div>

      <div className="flex items-start gap-3 border-l-2 border-primary pl-3">
        <TerminalIcon className="mt-0.5 size-4 text-primary" />
        <div>
          <p className="font-mono text-xs text-foreground">memo update</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The CLI command updates the managed source checkout and refreshes uv and pnpm dependencies.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
