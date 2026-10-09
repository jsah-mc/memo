import { CheckIcon } from "lucide-react";

export const AGENT_WIZARD_STEPS = [
  "Purpose",
  "Style",
  "Identity",
  "Soul",
  "Runtime",
  "Apps",
] as const;

export const DEFAULT_AGENT_SOUL =
  "Be honest, thoughtful, and curious. Respect my preferences, admit uncertainty, and help me make progress.";

export const AGENT_TEXTAREA_CLASS =
  "min-h-24 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export function AgentWizardProgress({ step }: Readonly<{ step: number }>) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Step ${step + 1} of ${AGENT_WIZARD_STEPS.length}`}
    >
      {AGENT_WIZARD_STEPS.map((label, index) => (
        <div key={label} className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {index < step ? <CheckIcon className="size-3" /> : index + 1}
          </span>
          <span
            className={`truncate text-[10px] ${index === step ? "text-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
