import { CheckCircle2Icon, CircleXIcon, Clock3Icon, LoaderCircleIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTaskActivity } from "@/agents/task-activity";

const elapsed = (start: number, end = Date.now()) => `${Math.max(0, Math.round((end - start) / 1000))}s`;

export function TaskActivitySidebar() {
  const items = useTaskActivity((state) => state.items);
  const clear = useTaskActivity((state) => state.clear);
  return <aside className="h-full w-[380px] shrink-0 overflow-y-auto border-l border-border/60 bg-background/95 pt-14 backdrop-blur-xl">
    <div className="flex items-center justify-between border-b border-border/60 p-4"><div><h2 className="text-sm font-semibold">Task activity</h2><p className="text-xs text-muted-foreground">Live runs, tools, timing, and errors</p></div><Button size="icon" variant="ghost" aria-label="Clear completed activity" onClick={clear}><Trash2Icon className="size-4" /></Button></div>
    <div className="grid gap-3 p-3">{items.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">Agent runs will appear here.</p>}{items.map((item) => { const Icon = item.status === "running" ? LoaderCircleIcon : item.status === "done" ? CheckCircle2Icon : CircleXIcon; return <article key={item.id} className="rounded-xl border border-border/60 bg-muted/15 p-3"><div className="flex gap-2"><Icon className={`mt-0.5 size-4 shrink-0 ${item.status === "running" ? "animate-spin text-primary" : item.status === "done" ? "text-emerald-400" : "text-destructive"}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3Icon className="size-3" />{elapsed(item.startedAt, item.finishedAt)} · {item.status}</p></div></div>{item.tools.length > 0 && <div className="mt-3 grid gap-1 border-l border-border pl-3">{item.tools.map((tool) => <div key={tool.id} className="flex items-center gap-2 text-xs text-muted-foreground"><WrenchIcon className="size-3" /><span className="min-w-0 flex-1 truncate">{tool.name}</span><span>{tool.status}</span></div>)}</div>}{item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}</article>; })}</div>
  </aside>;
}
