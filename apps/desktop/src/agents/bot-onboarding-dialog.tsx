import { useEffect, useRef, useState, type FormEvent } from "react";
import { BotIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import {
  getBotSettings,
  saveBotSettings,
  type PermissionMode,
} from "@/agents/bot-settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type StoredBot = Readonly<{
  agentId?: string;
  name: string;
  enabled: boolean;
}>;

const DEFAULT_INSTRUCTIONS =
  "Act as a persistent task bot. Track the current objective, report progress briefly, and finish with the next useful action.";

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bot";

const PERMISSION_MODES: ReadonlyArray<{
  id: PermissionMode;
  label: string;
  description: string;
}> = [
  {
    id: "full_access",
    label: "Full access",
    description: "Allow desktop control without asking.",
  },
  {
    id: "approve_for_me",
    label: "Approve for me",
    description: "Ask before desktop control.",
  },
  {
    id: "always_ask",
    label: "Always ask",
    description: "Ask before every desktop control session.",
  },
];

export function BotOnboardingDialog({
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}>) {
  const { agents, activeAgent } = useAgents();
  const profiles = [activeAgent, ...agents].filter(
    (agent, index, values) =>
      values.findIndex((item) => item.id === agent.id) === index,
  );
  const [agentId, setAgentId] = useState(activeAgent.id);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("always_ask");
  const [existing, setExisting] = useState<readonly StoredBot[]>([]);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setAgentId(activeAgent.id);
    setName("");
    setCommand("");
    setInstructions(DEFAULT_INSTRUCTIONS);
    setPermissionMode("always_ask");
    setError("");
    const list = window.desktopApi?.bots?.list;
    if (list) {
      void list()
        .then((bots) => setExisting(bots))
        .catch(() => setExisting([]));
    }
  }, [open, activeAgent.id]);

  const agent = profiles.find((profile) => profile.id === agentId) ?? activeAgent;
  const trimmedName = name.trim();
  const duplicate = existing.some(
    (bot) =>
      bot.agentId !== agentId &&
      bot.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase(),
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!trimmedName) {
      setError("Give your bot a name.");
      return;
    }
    if (duplicate) {
      setError(`A bot named "${trimmedName}" already exists.`);
      return;
    }
    submitting.current = true;
    try {
      saveBotSettings(agentId, {
        ...getBotSettings(agentId, agent.name),
        enabled: true,
        name: trimmedName,
        command: slug(command || trimmedName),
        instructions: instructions.trim() || DEFAULT_INSTRUCTIONS,
        permissionMode,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save the bot.",
      );
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <BotIcon className="size-4" />
          </div>
          <DialogTitle>Set up your first bot</DialogTitle>
          <DialogDescription>
            Bots are persistent task assistants saved to ~/.memo/bots.json,
            shared with the Memo terminal app.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-xs font-medium">
            <span className="text-muted-foreground">Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.role}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-xs font-medium">
              <span className="text-muted-foreground">Bot name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Builder"
                required
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              <span className="text-muted-foreground">Command</span>
              <div className="flex items-center border border-input bg-background px-2 focus-within:border-ring">
                <span className="font-mono text-sm text-primary">/</span>
                <Input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder={slug(trimmedName || "bot")}
                  className="border-0 px-1 font-mono focus-visible:ring-0"
                />
              </div>
            </label>
          </div>
          <fieldset className="grid gap-2 border border-border p-3">
            <legend className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
              Permissions
            </legend>
            {PERMISSION_MODES.map((mode) => (
              <label
                key={mode.id}
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  type="radio"
                  name={`bot-onboarding-permission-${agentId}`}
                  checked={permissionMode === mode.id}
                  onChange={() => setPermissionMode(mode.id)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="grid gap-0.5">
                  <span className="text-xs">{mode.label}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {mode.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1.5 text-xs font-medium">
            <span className="text-muted-foreground">Bot instructions</span>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={5}
              className="resize-y border border-input bg-background p-3 text-sm leading-relaxed outline-none focus:border-ring"
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create bot</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
