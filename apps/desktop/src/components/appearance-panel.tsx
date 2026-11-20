import { useState } from "react";
import {
  CheckIcon,
  LaptopIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
} from "lucide-react";
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "@/theme";

const choices = [
  { id: "system" as const, label: "System", description: "Match your computer", icon: LaptopIcon },
  { id: "light" as const, label: "Light", description: "Use the light theme", icon: SunIcon },
  { id: "dark" as const, label: "Dark", description: "Use the dark theme", icon: MoonIcon },
  { id: "catppuccin" as const, label: "Catppuccin", description: "Mocha in dark mode · Latte in light mode", icon: PaletteIcon },
  { id: "tokyonight" as const, label: "TokyoNight", description: "Night in dark mode · Day in light mode", icon: MoonIcon },
];

export function AppearancePanel() {
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());

  const choose = (value: ThemePreference) => {
    setTheme(value);
    setThemePreference(value);
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Color theme</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how Memo looks. Your choice is saved on this computer.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Color theme">
        {choices.map((choice) => {
          const Icon = choice.icon;
          const selected = theme === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(choice.id)}
              className={`relative flex min-h-28 flex-col items-start gap-3 rounded-lg border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/60"}`}
            >
              <Icon className="size-5" />
              <span>
                <span className="block text-sm font-medium">{choice.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{choice.description}</span>
              </span>
              {selected && <CheckIcon className="absolute right-3 top-3 size-4 text-primary" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
