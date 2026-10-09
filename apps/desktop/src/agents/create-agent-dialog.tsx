import { useRef, useState, type FormEvent } from "react";
import { ChevronLeftIcon, PlusIcon, SparklesIcon } from "lucide-react";
import {
  AGENT_TEXTAREA_CLASS,
  AGENT_WIZARD_STEPS,
  AgentWizardProgress,
  DEFAULT_AGENT_SOUL,
} from "@/agents/agent-wizard-ui";
import { AGENT_PRESETS, type AgentPreset } from "@/agents/agent-presets";
import { AGENT_STYLES } from "@/agents/agent-personality";
import { useAgents } from "@/agents/agent-provider";
import { CLI_OPTIONS, type CLIBackendId } from "@/agents/cli-options";
import { COMPOSIO_TOOLKITS } from "@/agents/composio-options";
import { ComposioPanel } from "@/components/composio-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CreateAgentDialog({
  onboarding = false,
}: Readonly<{ onboarding?: boolean }>) {
  const { createAgent } = useAgents();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState("general");
  const [style, setStyle] = useState("balanced");
  const [name, setName] = useState("Assistant");
  const [role, setRole] = useState("General assistant");
  const [description, setDescription] = useState(AGENT_PRESETS[0].description);
  const [soul, setSoul] = useState(DEFAULT_AGENT_SOUL);
  const [instructions, setInstructions] = useState(
    AGENT_PRESETS[0].instructions,
  );
  const [color, setColor] = useState("var(--chart-5)");
  const [cli, setCli] = useState<CLIBackendId>("codex");
  const [model, setModel] = useState("gpt-5.6-luna");
  const [composioEnabled, setComposioEnabled] = useState(false);
  const [computerTarget, setComputerTarget] = useState<"host" | "virtual">(
    "host",
  );
  const [composioToolkits, setComposioToolkits] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const choosePreset = (preset: AgentPreset) => {
    setPresetId(preset.id);
    setName(preset.id === "custom" ? "" : preset.name);
    setRole(preset.id === "custom" ? "" : preset.role);
    setDescription(preset.id === "custom" ? "" : preset.description);
    setInstructions(preset.id === "custom" ? "" : preset.instructions);
  };
  const reset = () => {
    setStep(0);
    choosePreset(AGENT_PRESETS[0]);
    setStyle("balanced");
    setSoul(DEFAULT_AGENT_SOUL);
    setColor("var(--chart-5)");
    setCli("codex");
    setModel("gpt-5.6-luna");
    setComposioEnabled(false);
    setComputerTarget("host");
    setComposioToolkits([]);
    setError("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    if (step < AGENT_WIZARD_STEPS.length - 1) {
      setError("");
      setStep(step + 1);
      return;
    }
    if (
      ![name, role, description, soul, instructions, model].every((value) =>
        value.trim(),
      )
    ) {
      setError(
        "Complete your agent's identity, soul, instructions, and model before creating it.",
      );
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await createAgent({
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        style,
        soul: soul.trim(),
        instructions: instructions.trim(),
        cli,
        model: model.trim(),
        color,
        composioEnabled,
        composioUserId: "",
        composioToolkits,
        computerTarget,
      });
      setOpen(false);
      reset();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create agent.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const selectedCli = CLI_OPTIONS.find((option) => option.id === cli)?.label;
  const invalidStep =
    (step === 2 && ![name, role, description].every((value) => value.trim())) ||
    (step === 3 && ![soul, instructions].every((value) => value.trim())) ||
    (step === 4 && !model.trim());

  return (
    <Dialog
      open={onboarding || open}
      onOpenChange={(value) => {
        if (!onboarding && !saving) setOpen(value);
      }}
    >
      {!onboarding && (
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              className="h-8 w-full justify-start gap-2 px-2.5"
              aria-label="Create agent"
            />
          }
        >
          <PlusIcon className="size-4" /> New agent
        </DialogTrigger>
      )}
      <DialogContent
        showCloseButton={!onboarding}
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <SparklesIcon className="size-4" />
          </div>
          <DialogTitle>
            {onboarding ? "Meet your first agent" : "Create an agent"}
          </DialogTitle>
          <DialogDescription>
            Give your agent a purpose, a personality, and a soul. Everything you
            choose is saved with its profile.
          </DialogDescription>
        </DialogHeader>
        <AgentWizardProgress step={step} />
        <form className="grid gap-4" onSubmit={submit}>
          {step === 0 && (
            <div className="grid grid-cols-2 gap-2">
              {AGENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={presetId === preset.id}
                  onClick={() => choosePreset(preset)}
                  className={`rounded-xl p-3 text-left transition-colors ${presetId === preset.id ? "bg-primary/12 ring-1 ring-primary" : "bg-muted/60 hover:bg-muted"} ${preset.id === "custom" ? "col-span-2" : ""}`}
                >
                  <span className="block text-sm font-medium">
                    {preset.name}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-2">
              {AGENT_STYLES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={style === option.id}
                  onClick={() => setStyle(option.id)}
                  className={`rounded-xl p-4 text-left ${style === option.id ? "bg-primary/12 ring-1 ring-primary" : "bg-muted/60 hover:bg-muted"}`}
                >
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-xs font-medium">
                  Name
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Nova"
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                  Role
                  <Input
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    placeholder="Research partner"
                    required
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-medium">
                Description
                <textarea
                  className={AGENT_TEXTAREA_CLASS}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What does this agent help you with?"
                  required
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-xs font-medium">
                  Profile color
                </legend>
                <div className="flex gap-3">
                  {[
                    "var(--primary)",
                    "var(--chart-1)",
                    "var(--chart-2)",
                    "var(--chart-4)",
                    "var(--chart-5)",
                  ].map((value, i) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={`Profile color ${i + 1}`}
                      aria-pressed={color === value}
                      onClick={() => setColor(value)}
                      style={{ backgroundColor: value }}
                      className={`size-7 rounded-full ${color === value ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-medium">
                Soul
                <textarea
                  className={AGENT_TEXTAREA_CLASS}
                  value={soul}
                  onChange={(event) => setSoul(event.target.value)}
                  placeholder="Values, personality, boundaries, and how your agent should treat you."
                  required
                />
              </label>
              <p className="text-xs text-muted-foreground">
                The soul guides who your agent is. Instructions guide how it
                works.
              </p>
              <label className="grid gap-1.5 text-xs font-medium">
                Working instructions
                <textarea
                  className={AGENT_TEXTAREA_CLASS}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="What should it focus on and how should it approach tasks?"
                  required
                />
              </label>
            </div>
          )}
          {step === 4 && (
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-xs font-medium">
                Runtime
                <select
                  value={cli}
                  onChange={(event) => {
                    const option = CLI_OPTIONS.find(
                      (item) => item.id === event.target.value,
                    );
                    if (option) {
                      setCli(option.id);
                      setModel(option.defaultModel);
                    }
                  }}
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {CLI_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Model
                <Input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Model name"
                  required
                />
              </label>
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium">Computer</legend>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={computerTarget === "host" ? "default" : "outline"}
                    onClick={() => setComputerTarget("host")}
                  >
                    This computer
                  </Button>
                  <Button
                    type="button"
                    variant={
                      computerTarget === "virtual" ? "default" : "outline"
                    }
                    onClick={() => setComputerTarget("virtual")}
                  >
                    Shared VM
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  All agents using Shared VM connect to the same virtual desktop
                  configured in Settings.
                </p>
              </fieldset>
              <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                Keep your existing provider login. App connections are optional
                and can be added next.
              </p>
            </div>
          )}
          {step === 5 && (
            <div className="grid gap-4">
              <div className="rounded-xl bg-primary/10 p-3">
                <p className="text-sm font-medium">
                  {name} ·{" "}
                  {AGENT_STYLES.find((option) => option.id === style)?.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {description}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedCli} · {model}
                </p>
              </div>
              <label className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={composioEnabled}
                  onChange={(event) => setComposioEnabled(event.target.checked)}
                />{" "}
                Enable app integrations for this agent
              </label>
              {composioEnabled && (
                <>
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-xs font-medium">
                      Apps this agent may use
                    </legend>
                    <div className="grid grid-cols-2 gap-2">
                      {COMPOSIO_TOOLKITS.map((toolkit) => (
                        <label
                          key={toolkit.id}
                          className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={composioToolkits.includes(toolkit.id)}
                            onChange={(event) =>
                              setComposioToolkits((current) =>
                                event.target.checked
                                  ? [...current, toolkit.id]
                                  : current.filter((id) => id !== toolkit.id),
                              )
                            }
                          />
                          {toolkit.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-xs text-muted-foreground">
                    {composioToolkits.length
                      ? `${composioToolkits.length} apps allowed.`
                      : "All connected apps and tool discovery allowed."}
                  </p>
                  <ComposioPanel />
                </>
              )}
              {!composioEnabled && (
                <p className="text-xs text-muted-foreground">
                  You can create your agent now and connect apps later in
                  Settings.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setStep(step - 1)}
              >
                <ChevronLeftIcon className="size-4" /> Back
              </Button>
            ) : (
              !onboarding && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              )
            )}
            <Button type="submit" disabled={saving || invalidStep}>
              {saving
                ? "Creating…"
                : step === AGENT_WIZARD_STEPS.length - 1
                  ? "Create agent"
                  : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
