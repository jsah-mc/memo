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

export function VirtualDesktopPanel({ target = "local_vm" }: Readonly<{ target?: "local_vm" | "vps" }>) {
  const local = target === "local_vm";
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState(22);
  const [identityFile, setIdentityFile] = useState("");
  const [status, setStatus] = useState<VirtualDesktopProbe | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const next = await window.desktopApi.virtualDesktop.get(target);
    setHost(next.host ?? "");
    setUser(next.user ?? "");
    setPort(next.port ?? 22);
    setIdentityFile(next.identityFile ?? "");
    setStatus(next);
  }, [target]);

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
            {local ? "Local VM setup" : "VPS connection"}
          </p>
          <p className="text-xs text-muted-foreground">
            {local
              ? "Run the packaged desktop locally with Podman or Docker."
              : "Connect agents to a separately hosted remote desktop."}
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
          <p className="text-xs font-medium">{local ? "Local virtual desktop" : "Remote VPS desktop"}</p>
          <p className="text-xs text-muted-foreground">
            {local ? "This environment runs on this computer." : "This endpoint is stored separately from Local VM."}
          </p>
        </div>
        {!local && <label className="grid gap-1 text-xs text-muted-foreground">
          SSH host
          <Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="vps.example.com" />
        </label>}
        {!local && <div className="grid grid-cols-[1fr_100px] gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            SSH user
            <Input value={user} onChange={(event) => setUser(event.target.value)} placeholder="ubuntu" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Port
            <Input type="number" value={port} onChange={(event) => setPort(Number(event.target.value))} />
          </label>
        </div>}
        {!local && <label className="grid gap-1 text-xs text-muted-foreground">
          SSH identity file <span className="text-muted-foreground/70">(optional; uses your SSH agent by default)</span>
          <Input value={identityFile} onChange={(event) => setIdentityFile(event.target.value)} placeholder="C:\\Users\\you\\.ssh\\id_ed25519" />
        </label>}
        {!local && <p className="text-xs text-muted-foreground">
          Memo copies its desktop package over SSH, starts it with Docker or Podman, and creates a private local tunnel automatically.
        </p>}
        <p className="text-xs text-muted-foreground">
          {status?.message ??
            (local ? "Start the Local VM." : "Enter the VPS SSH connection details.")}
        </p>
        {local && <p className="text-xs text-muted-foreground">
          Local engine:{" "}
          {status?.containerEngine ?? "Podman or Docker not found"}
          {status?.containerEngine === "podman" ? " (preferred)" : ""}
        </p>}
        <div className="flex flex-wrap gap-2">
          {!local && <Button
            type="button"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("save", () =>
                window.desktopApi.virtualDesktop.setupVps({
                  host,
                  user,
                  port,
                  identityFile: identityFile || undefined,
                }),
              )
            }
          >
            {busy === "save" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <SaveIcon className="size-3.5" />
            )}{" "}
            Set up VPS
          </Button>}
          {local && <Button
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
          </Button>}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => void window.desktopApi.virtualDesktop.open(target)}
          >
            View <ExternalLinkIcon className="size-3.5" />
          </Button>
          {local && <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("stop", () => window.desktopApi.virtualDesktop.stop())
            }
          >
            Stop local
          </Button>}
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
