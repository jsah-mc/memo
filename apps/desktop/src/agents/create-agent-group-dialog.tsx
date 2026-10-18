import { useMemo, useState } from "react";
import { UsersIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import { useAgentGroups } from "@/agents/agent-groups";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CreateAgentGroupDialog() {
  const { agents } = useAgents();
  const { createGroup } = useAgentGroups();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const canCreate = useMemo(
    () => name.trim().length > 0 && memberIds.length >= 2,
    [memberIds.length, name],
  );

  const submit = () => {
    try {
      createGroup(name, memberIds);
      setName("");
      setMemberIds([]);
      setError("");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create group.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2.5 text-xs" />}>
        <UsersIcon className="size-4" /> New group
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create agent group</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-xs font-medium">
            Group name
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Launch team" autoFocus />
          </label>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium">Agents</legend>
            {agents.map((agent) => (
              <label key={agent.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={memberIds.includes(agent.id)}
                  onChange={(event) =>
                    setMemberIds((current) =>
                      event.target.checked
                        ? [...current, agent.id]
                        : current.filter((id) => id !== agent.id),
                    )
                  }
                />
                <span><strong>{agent.name}</strong> <span className="text-muted-foreground">· {agent.role}</span></span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">Each member answers in order and receives the earlier members’ replies as context.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!canCreate} onClick={submit}>Create group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
