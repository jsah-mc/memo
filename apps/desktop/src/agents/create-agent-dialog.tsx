import { useState, type FormEvent } from "react";
import { CheckIcon, ChevronLeftIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { AGENT_PRESETS, type AgentPreset } from "@/agents/agent-presets";
import { useAgents } from "@/agents/agent-provider";
import { CLI_OPTIONS, type CLIBackendId } from "@/agents/cli-options";
import { COMPOSIO_TOOLKITS } from "@/agents/composio-options";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const STEPS = ["Preset", "Runtime", "Tools", "Details"] as const;

export function CreateAgentDialog() {
  const { createAgent } = useAgents();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState("general");
  const [name, setName] = useState("Assistant");
  const [role, setRole] = useState("General assistant");
  const [instructions, setInstructions] = useState(AGENT_PRESETS[0].instructions);
  const [cli, setCli] = useState<CLIBackendId>("codex");
  const [model, setModel] = useState("gpt-5.6-luna");
  const [composioEnabled, setComposioEnabled] = useState(false);
  const [composioToolkits, setComposioToolkits] = useState<string[]>([]);
  const [error, setError] = useState("");

  const choosePreset = (preset: AgentPreset) => {
    setPresetId(preset.id);
    setName(preset.id === "custom" ? "" : preset.name);
    setRole(preset.id === "custom" ? "" : preset.role);
    setInstructions(preset.id === "custom" ? "" : preset.instructions);
  };

  const reset = () => {
    setStep(0); setPresetId("general"); setName("Assistant");
    setRole("General assistant"); setInstructions(AGENT_PRESETS[0].instructions);
    setCli("codex"); setModel("gpt-5.6-luna"); setComposioEnabled(false);
    setComposioToolkits([]); setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < 3) { setStep(step + 1); return; }
    const cleanName = name.trim();
    const cleanRole = role.trim();
    const cleanInstructions = instructions.trim();
    const cleanModel = model.trim();
    if (!cleanName || !cleanRole || !cleanInstructions || !cleanModel) return;
    setError("");
    try {
      await createAgent({
        name: cleanName, role: cleanRole, instructions: cleanInstructions,
        cli, model: cleanModel, color: "var(--chart-5)", composioEnabled,
        composioUserId: "",
        composioToolkits,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create agent.");
      return;
    }
    setOpen(false); reset();
  };

  const selectedCli = CLI_OPTIONS.find((option) => option.id === cli)?.label;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2.5" aria-label="Create agent" />}>
        <PlusIcon className="size-4" /> New agent
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary"><SparklesIcon className="size-4" /></div>
          <DialogTitle>Create an agent</DialogTitle>
          <DialogDescription>Start from a preset, then choose how it runs.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of 4`}>
          {STEPS.map((label, index) => (
            <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {index < step ? <CheckIcon className="size-3.5" /> : index + 1}
              </span>
              <span className={`truncate text-xs ${index === step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </div>
          ))}
        </div>

        <form className="grid gap-4" onSubmit={submit}>
          {step === 0 && (
            <div className="grid grid-cols-2 gap-2">
              {AGENT_PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => choosePreset(preset)} className={`rounded-xl p-3 text-left transition-colors ${presetId === preset.id ? "bg-primary/12 ring-1 ring-primary" : "bg-muted/60 hover:bg-muted"} ${preset.id === "custom" ? "col-span-2" : ""}`}>
                  <span className="block text-sm font-medium">{preset.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-xs font-medium">CLI
                <select value={cli} onChange={(event) => { const option = CLI_OPTIONS.find((item) => item.id === event.target.value); if (option) { setCli(option.id); setModel(option.defaultModel); } }} className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30">
                  {CLI_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">Model<Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model name" required /></label>
              <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">Memo will use {selectedCli} with <span className="text-foreground">{model || "your model"}</span> for this agent.</p>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <button type="button" onClick={() => setComposioEnabled(!composioEnabled)} className={`flex items-center justify-between rounded-xl p-3 text-left ${composioEnabled ? "bg-primary/12 ring-1 ring-primary" : "bg-muted/60"}`}>
                <span><span className="block text-sm font-medium">Composio apps</span><span className="mt-1 block text-xs text-muted-foreground">Let this agent use connected services through Memo.</span></span>
                <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${composioEnabled ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`size-5 rounded-full bg-white transition-transform ${composioEnabled ? "translate-x-4" : ""}`} /></span>
              </button>
              {composioEnabled && <>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-xs font-medium">Available tools</legend>
                  <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {COMPOSIO_TOOLKITS.map((toolkit) => {
                      const selected = composioToolkits.includes(toolkit.id);
                      return (
                        <button
                          key={toolkit.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setComposioToolkits((current) => selected ? current.filter((id) => id !== toolkit.id) : [...current, toolkit.id])}
                          className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${selected ? "bg-primary/12 text-foreground ring-1 ring-primary" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                        >
                          {toolkit.label}
                          {selected && <CheckIcon className="size-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <p className="text-xs leading-relaxed text-muted-foreground">{composioToolkits.length ? `${composioToolkits.length} toolkit${composioToolkits.length === 1 ? "" : "s"} selected.` : "No restrictions — Composio can discover tools at runtime."}</p>
              </>}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-xs font-medium">Name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Researcher" autoFocus required /></label>
                <label className="grid gap-1.5 text-xs font-medium">Role<Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Research analyst" required /></label>
              </div>
              <label className="grid gap-1.5 text-xs font-medium">Instructions
                <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe how this agent should behave." className="min-h-28 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" required />
              </label>
              <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><span>{selectedCli}</span><span>·</span><span>{model}</span></div>
              {composioEnabled && <div className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">Composio enabled{composioToolkits.length ? ` · ${composioToolkits.map((id) => COMPOSIO_TOOLKITS.find((item) => item.id === id)?.label ?? id).join(", ")}` : " · tool discovery"}</div>}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="mt-1">
            {step > 0 ? <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeftIcon className="size-4" /> Back</Button> : <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
            <Button type="submit" disabled={(step === 1 && !model.trim()) || (step === 3 && (!name.trim() || !role.trim() || !instructions.trim()))}>{step === 3 ? "Create agent" : "Continue"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
