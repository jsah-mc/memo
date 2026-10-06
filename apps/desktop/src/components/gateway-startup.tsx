import { useEffect, useState, type ReactNode } from "react";
import { AlertCircleIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type StartupState = { state: "connecting" | "online" | "error"; message?: string };

export function GatewayStartup({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StartupState>({ state: "connecting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!window.desktopApi) {
      // Vite remains available for frontend development without Electron.
      setStatus({ state: "online" });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await window.desktopApi.getGatewayStatus();
        if (cancelled) return;
        if (next.running) {
          setStatus({ state: "online" });
        } else if (next.state === "error") {
          setStatus({ state: "error", message: next.message });
        } else {
          setStatus({ state: "connecting" });
          timer = setTimeout(() => void poll(), 500);
        }
      } catch (error) {
        if (!cancelled) setStatus({ state: "error", message: error instanceof Error ? error.message : "Could not start Memo." });
      }
    };
    const start = async () => {
      try {
        if (attempt > 0) await window.desktopApi.restartGateway();
        if (!cancelled) await poll();
      } catch (error) {
        if (!cancelled) setStatus({ state: "error", message: error instanceof Error ? error.message : "Could not restart Memo." });
      }
    };
    void start();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [attempt]);

  if (status.state === "online") return children;
  const failed = status.state === "error";
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="drag h-14 shrink-0" aria-label="Memo window" />
      <main className="flex flex-1 items-center justify-center px-8 pb-14">
        <section className="grid max-w-md justify-items-center gap-5 text-center" aria-live="polite" aria-busy={!failed}>
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/12 text-primary"><SparklesIcon className="size-8" /></span>
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{failed ? "Memo couldn’t start" : "Starting Memo"}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{failed ? status.message ?? "The local gateway could not start. Try again." : "Getting your local assistant ready…"}</p>
          </div>
          {failed ? <>
            <AlertCircleIcon className="size-5 text-destructive" />
            <Button onClick={() => { setStatus({ state: "connecting" }); setAttempt((value) => value + 1); }}>Try again</Button>
          </> : <LoaderCircleIcon className="size-5 animate-spin text-primary motion-reduce:animate-none" aria-label="Loading" />}
          <p className="text-xs text-muted-foreground">{failed ? "You can close and reopen Memo if the problem continues." : "The first launch can take a little longer."}</p>
        </section>
      </main>
    </div>
  );
}
