import { ShieldAlertIcon, TerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const isPermissionRequest = (value: unknown): value is PermissionRequest =>
  Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "kind" in value &&
      (value.kind === "computer_control" || value.kind === "shell_command") &&
      "command" in value &&
      typeof value.command === "string" &&
      "cwd" in value &&
      typeof value.cwd === "string",
  );

export function PermissionPrompt() {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const request = requests[0];

  useEffect(
    () =>
      window.desktopApi.onPermissionRequest((incoming) => {
        if (!isPermissionRequest(incoming)) return;
        setRequests((current) =>
          current.some(({ id }) => id === incoming.id)
            ? current
            : [...current, incoming],
        );
      }),
    [],
  );

  const respond = (allowed: boolean) => {
    if (!request) return;
    window.desktopApi.respondPermission({ id: request.id, allowed });
    setRequests((current) => current.filter(({ id }) => id !== request.id));
  };

  const computerControl = request?.kind === "computer_control";
  const Icon = computerControl ? ShieldAlertIcon : TerminalIcon;

  if (!request) return null;

  return (
    <section
      role="alertdialog"
      aria-label={computerControl ? "Computer control approval" : "Shell command approval"}
      className="mb-2 grid gap-3 rounded-2xl border border-amber-500/35 bg-background/95 p-4 shadow-xl backdrop-blur"
    >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {computerControl ? "Allow computer control?" : "Run this command?"}
            </p>
            <p className="text-xs text-muted-foreground">
              {computerControl
                ? "Memo wants to view and control your computer for this task."
                : "Memo wants to run a command on your computer."}
            </p>
          </div>
        </div>

        {computerControl ? (
          <div className="bg-muted/60 rounded-lg p-3 text-sm">
            <p>
              Memo may capture visible screens and send screenshots to the
              configured AI model.
            </p>
            <p className="text-muted-foreground mt-2">
              It may click, type, press keys, and scroll until this response
              finishes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Command
              </p>
              <pre className="bg-muted max-h-40 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                {request?.command}
              </pre>
            </div>
            <p className="text-muted-foreground text-xs">
              Working directory:{" "}
              <code className="text-foreground">{request?.cwd}</code>
            </p>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          This permission applies once and is never remembered.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => respond(false)}>
            Deny
          </Button>
          <Button onClick={() => respond(true)}>Allow once</Button>
        </div>
    </section>
  );
}
