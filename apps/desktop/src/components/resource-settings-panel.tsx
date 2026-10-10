import { useEffect, useState } from "react";
import { BatteryIcon, GaugeIcon, RocketIcon } from "lucide-react";

const modes = [
  { id: "low" as const, label: "Low power", detail: "2 compute threads · unload speech after 10 seconds", icon: BatteryIcon },
  { id: "balanced" as const, label: "Balanced", detail: "4 compute threads · unload speech after 30 seconds", icon: GaugeIcon },
  { id: "performance" as const, label: "Performance", detail: "8 compute threads · keep speech warm for 90 seconds", icon: RocketIcon },
];

export function ResourceSettingsPanel() {
  const [mode, setMode] = useState<ResourceMode>("balanced");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void window.desktopApi.resources.get().then((value) => setMode(value.mode)); }, []);
  const choose = async (next: ResourceMode) => {
    setSaving(true); setError("");
    try { const result = await window.desktopApi.resources.set(next); setMode(result.mode); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change resource mode."); }
    finally { setSaving(false); }
  };
  return <div className="grid gap-3">
    {modes.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" disabled={saving} onClick={() => void choose(item.id)} className={`flex items-center gap-3 rounded-xl border p-4 text-left ${mode === item.id ? "border-primary bg-primary/10" : "border-border/60 bg-muted/15 hover:bg-muted/30"}`}>
      <Icon className="size-5 text-primary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></span>{mode === item.id && <span className="text-xs font-medium text-primary">Active</span>}
    </button>; })}
    <p className="text-xs text-muted-foreground">Changing mode safely restarts the local gateway. Model requests already in progress should be allowed to finish first.</p>
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>;
}
