import { useCallback, useEffect, useState } from "react";
import { FolderOpenIcon, GitBranchIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkspaceSettingsPanel() {
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [label, setLabel] = useState("Before agent changes");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback((): void => {
    void window.desktopApi.workspace.get().then(setWorkspace);
  }, []);
  useEffect(refresh, [refresh]);
  const choose = async () => { setBusy(true); setMessage(""); try { setWorkspace(await window.desktopApi.workspace.choose()); } finally { setBusy(false); } };
  const checkpoint = async () => { setBusy(true); setMessage(""); try { const result = await window.desktopApi.workspace.checkpoint(label); setMessage(`Checkpoint saved with ${result.changes} changed files.`); refresh(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not create checkpoint."); } finally { setBusy(false); } };
  return <div className="grid gap-4">
    <section className="rounded-xl border border-border/60 bg-muted/15 p-4">
      <div className="flex items-start gap-3"><FolderOpenIcon className="mt-0.5 size-5 text-primary" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{workspace?.name ?? "No project selected"}</p><p className="truncate text-xs text-muted-foreground">{workspace?.path || "Choose the folder agents should work in."}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void choose()}>Choose</Button></div>
      {workspace?.path && <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><GitBranchIcon className="size-3.5" />{workspace.git ? `${workspace.changes} changed files` : "Not a Git project"}</div>}
    </section>
    <section className="grid gap-3 rounded-xl border border-border/60 p-4"><div><p className="text-sm font-medium">Create checkpoint</p><p className="text-xs text-muted-foreground">Saves a binary Git patch and copies untracked files before risky agent work.</p></div><div className="flex gap-2"><Input value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Checkpoint label" /><Button disabled={busy || !workspace?.git} onClick={() => void checkpoint()}><SaveIcon className="size-4" /> Save</Button></div>{message && <p className="text-xs text-muted-foreground">{message}</p>}</section>
  </div>;
}
