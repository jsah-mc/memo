import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PowerIcon,
  SaveIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function VirtualDesktopPanel() {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:3211");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [status, setStatus] = useState<VirtualDesktopProbe | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const next = await window.desktopApi.virtualDesktop.get();
    setEndpoint(next.endpoint);
    setHasToken(next.hasToken);
    setStatus(next);
  }, []);

  useEffect(() => {
    void refresh().catch((reason: unknown) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load virtual desktop settings.",
      ),
    );
  }, [refresh]);

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try {
      await action();
      setToken("");
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Virtual desktop action failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const connected = Boolean(status?.reachable);
  return (
    <section
      className="grid gap-3 rounded-xl bg-muted/35 p-3"
      aria-labelledby="virtual-desktop-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="virtual-desktop-title" className="text-sm font-medium">
            Local VM setup
          </p>
          <p className="text-xs text-muted-foreground">
            Configure the one virtual desktop shared by every agent.
          </p>
        </div>
        {connected ? (
          <CheckCircle2Icon className="mt-0.5 size-4 text-primary" />
        ) : (
          <CircleAlertIcon className="mt-0.5 size-4 text-destructive" />
        )}
      </div>

      <div className="grid gap-2">
        <div>
          <p className="text-xs font-medium">Shared virtual desktop</p>
          <p className="text-xs text-muted-foreground">
            One endpoint and one running VM are used by every virtual agent.
          </p>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Endpoint
          <Input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="http://127.0.0.1:3211"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Access token
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              hasToken
                ? "Saved — leave blank to keep"
                : "Paste the CUA_ENV_TOKEN"
            }
            autoComplete="off"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {status?.message ?? "Configure a local container or remote VPS."}
        </p>
        <p className="text-xs text-muted-foreground">
          Local engine:{" "}
          {status?.containerEngine ?? "Podman or Docker not found"}
          {status?.containerEngine === "podman" ? " (preferred)" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("save", () =>
                window.desktopApi.virtualDesktop.save({
                  endpoint,
                  token: token || undefined,
                }),
              )
            }
          >
            {busy === "save" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <SaveIcon className="size-3.5" />
            )}{" "}
            Save & use
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("start", () => window.desktopApi.virtualDesktop.start())
            }
          >
            {busy === "start" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <PowerIcon className="size-3.5" />
            )}{" "}
            Start local
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => void window.desktopApi.virtualDesktop.open()}
          >
            View <ExternalLinkIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("stop", () => window.desktopApi.virtualDesktop.stop())
            }
          >
            Stop local
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
