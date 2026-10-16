import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

type Update = { available: boolean; version?: string; notes?: string };
type Phase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";
const useUpdate = create<{
  phase: Phase;
  update?: Update;
  current: string;
  error: string;
  downloaded: number;
  total?: number;
  dismissed: boolean;
}>(() => ({
  phase: "idle",
  current: "",
  error: "",
  downloaded: 0,
  dismissed: false,
}));

async function check() {
  if (
    ["checking", "downloading", "installing", "ready"].includes(
      useUpdate.getState().phase,
    )
  )
    return;
  useUpdate.setState({ phase: "checking", error: "", dismissed: false });
  try {
    const update = await invoke<Update>("update_check");
    useUpdate.setState({
      update,
      phase: update.available ? "available" : "current",
    });
  } catch (error) {
    useUpdate.setState({ phase: "error", error: String(error) });
  }
}

async function install() {
  if (useUpdate.getState().phase !== "available") return;
  useUpdate.setState({
    phase: "downloading",
    downloaded: 0,
    total: undefined,
    error: "",
  });
  let unlistenProgress: (() => void) | undefined;
  let unlistenInstalling: (() => void) | undefined;
  try {
    unlistenProgress = await listen<{ chunk: number; total?: number }>(
      "update-progress",
      ({ payload }) => {
        useUpdate.setState((state) => ({
          downloaded: state.downloaded + payload.chunk,
          total: payload.total,
        }));
      },
    );
    unlistenInstalling = await listen("update-installing", () =>
      useUpdate.setState({ phase: "installing" }),
    );
    await invoke("update_install");
    useUpdate.setState({ phase: "ready" });
  } catch (error) {
    useUpdate.setState({ phase: "error", error: String(error) });
  } finally {
    unlistenProgress?.();
    unlistenInstalling?.();
  }
}

export function UpdateController() {
  const { phase, dismissed } = useUpdate();
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getVersion()
      .then((current) => useUpdate.setState({ current }))
      .catch(() => {});
    // Recreate the timer after StrictMode cleanup so the check isn't lost.
    const timer = window.setTimeout((): void => {
      void check();
    }, 15000);
    return () => window.clearTimeout(timer);
  }, []);
  if (
    dismissed ||
    !["available", "downloading", "installing", "ready"].includes(phase)
  )
    return null;
  return (
    <aside
      className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border bg-background p-5 shadow-xl"
      aria-label="Memo update"
    >
      <AppUpdates />
      <Button
        variant="ghost"
        className="mt-2 w-full"
        onClick={() => useUpdate.setState({ dismissed: true })}
      >
        {phase === "available" ? "Later" : "Hide"}
      </Button>
    </aside>
  );
}

export function AppUpdates() {
  const { phase, update, current, error, downloaded, total } = useUpdate();
  const native = "__TAURI_INTERNALS__" in window;
  const busy = ["checking", "downloading", "installing"].includes(phase);
  return (
    <section className="grid gap-3" aria-label="App updates">
      <h3 className="font-medium">
        Memo updates{current ? ` · ${current}` : ""}
      </h3>
      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {!native
          ? "Updates are available in the installed desktop app."
          : phase === "checking"
            ? "Checking for updates…"
            : phase === "current"
              ? "You're up to date."
              : phase === "available"
                ? `Memo ${update?.version} is available.`
                : phase === "downloading"
                  ? "Downloading update…"
                  : phase === "installing"
                    ? "Installing update. Memo may close automatically."
                    : phase === "ready"
                      ? "Update installed. Restart Memo to finish."
                      : phase === "error"
                        ? "Could not complete the update. Please try again."
                        : "Check for the latest version of Memo."}
      </p>
      {phase === "downloading" && (
        <progress
          className="w-full"
          aria-label="Download progress"
          max={total || undefined}
          value={total ? Math.min(downloaded, total) : undefined}
        />
      )}
      {phase === "available" && update?.notes && (
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm">
          {update.notes}
        </p>
      )}
      {phase === "available" && (
        <p className="text-xs text-muted-foreground">
          Finish any running tasks before installing.
        </p>
      )}
      {error && (
        <p className="break-words text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {phase === "available" ? (
        <Button onClick={() => void install()}>Download and install</Button>
      ) : phase === "ready" ? (
        <Button
          onClick={() =>
            void invoke("update_restart").catch((error) =>
              useUpdate.setState({ error: String(error) }),
            )
          }
        >
          Restart Memo
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={!native || busy}
          onClick={() => void check()}
        >
          {busy ? "Please wait…" : "Check for updates"}
        </Button>
      )}
    </section>
  );
}
