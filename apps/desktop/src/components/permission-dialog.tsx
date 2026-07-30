import { ShieldAlertIcon, TerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

export function PermissionDialog() {
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

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && request) respond(false);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Icon className="size-5" />
          </div>
          <DialogTitle>
            {computerControl ? "Allow computer control?" : "Run this command?"}
          </DialogTitle>
          <DialogDescription>
            {computerControl
              ? "Memo wants to view and control your computer for this task."
              : "Memo wants to run a command on your computer."}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={() => respond(false)}>
            Deny
          </Button>
          <Button onClick={() => respond(true)}>Allow once</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
