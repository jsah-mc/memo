import { useMemo, useState } from "react";
import { PencilIcon } from "lucide-react";
import type { AgentGroup } from "@/agents/agent-groups";
import { useAgentGroups } from "@/agents/agent-groups";
import { useAgents } from "@/agents/agent-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function EditAgentGroupDialog({ group }: Readonly<{ group: AgentGroup }>) {
  const { agents } = useAgents();
  const { updateGroup } = useAgentGroups();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [memberIds, setMemberIds] = useState<string[]>([...group.memberIds]);
  const [error, setError] = useState("");
  const canSave = useMemo(() => name.trim().length > 0 && memberIds.length >= 2, [memberIds.length, name]);

  const changeOpen = (next: boolean) => {
    if (next) {
      setName(group.name);
      setMemberIds([...group.memberIds]);
      setError("");
    }
    setOpen(next);
  };
  const submit = () => {
    try {
      updateGroup(group.id, name, memberIds);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update group.");
    }
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button size="icon" variant="ghost" className="absolute right-7 top-1.5 z-10 size-7 opacity-55 hover:opacity-100" aria-label={`Edit ${group.name}`} />}>
      <PencilIcon className="size-3.5" />
    </DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Edit agent group</DialogTitle></DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-xs font-medium">Group name<Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <fieldset className="grid gap-2"><legend className="mb-1 text-xs font-medium">Agents</legend>
          {agents.map((agent) => <label key={agent.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
            <input type="checkbox" checked={memberIds.includes(agent.id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} />
            <span><strong>{agent.name}</strong> <span className="text-muted-foreground">· {agent.role}</span></span>
          </label>)}
        </fieldset>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!canSave} onClick={submit}>Save changes</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
