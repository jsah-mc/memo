import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  LogInIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function AiAgentsPanel() {
  const [backends, setBackends] = useState<AgentBackendData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
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

  const runAction = async (backend: AgentBackendData) => {
    setActionId(backend.id);
    setError("");
    try {
      if (backend.installed && backend.id === "codex") {
        await window.desktopApi.agents.signIn(backend.id);
      } else {
        await window.desktopApi.agents.openInstallGuide(backend.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Action failed.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Connect AI agents</h3>
          <p className="text-xs text-muted-foreground">
            Select a runtime for installation, location, and sign-in details.
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
        {backends.map((backend) => {
          const expanded = selectedId === backend.id;
          const needsSignIn =
            backend.id === "codex" &&
            backend.installed &&
            backend.auth_status !== "ready";
          const StatusIcon = needsSignIn
            ? CircleAlertIcon
            : backend.installed
              ? CheckCircle2Icon
              : CircleDashedIcon;
          return (
            <article
              key={backend.id}
              className="rounded-xl border border-border/60 bg-muted/20"
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 p-3 text-left"
                aria-expanded={expanded}
                onClick={() => setSelectedId(expanded ? null : backend.id)}
              >
                <StatusIcon
                  className={`size-5 shrink-0 ${
                    needsSignIn
                      ? "text-amber-500"
                      : backend.installed
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {backend.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {needsSignIn
                      ? "Installed · sign-in required"
                      : backend.installed
                        ? "Installed and ready"
                        : `Install ${backend.executable} to connect`}
                  </p>
                </div>
                <ChevronDownIcon
                  className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <div className="grid gap-2 border-t border-border/50 px-3 py-3">
                  {backend.installed ? (
                    <p className="break-all font-mono text-[11px] text-muted-foreground">
                      {backend.resolved_executable}
                    </p>
                  ) : (
                    <code className="rounded-lg bg-background px-2.5 py-2 text-[11px]">
                      {backend.install_command}
                    </code>
                  )}
                  {needsSignIn && backend.auth_message && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {backend.auth_message}
                    </p>
                  )}
                  {backend.installed && backend.id !== "codex" ? (
                    <p className="text-xs text-muted-foreground">
                      Memo found this runtime. Configure its provider
                      credentials in the runtime when required.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={actionId === backend.id}
                      onClick={() => void runAction(backend)}
                    >
                      {backend.installed ? (
                        <>
                          <LogInIcon /> Open Codex sign-in
                        </>
                      ) : (
                        <>
                          <ExternalLinkIcon /> Open installation guide
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
