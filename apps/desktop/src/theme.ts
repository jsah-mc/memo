export type ThemePreference =
  | "system"
  | "light"
  | "dark"
  | "latte"
  | "frappe"
  | "macchiato";

export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "memo.theme";

const THEME_CLASSES = ["theme-latte", "theme-frappe", "theme-macchiato"];
const DARK_THEMES: readonly ResolvedTheme[] = ["dark", "frappe", "macchiato"];

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return prefersDark ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ||
    stored === "dark" ||
    stored === "latte" ||
    stored === "frappe" ||
    stored === "macchiato"
    ? stored
    : "system";
}

export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark = DARK_THEMES.includes(resolved);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  for (const themeClass of THEME_CLASSES) {
    root.classList.toggle(themeClass, themeClass === `theme-${resolved}`);
  }
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyTheme(preference);
  window.dispatchEvent(
    new CustomEvent("memo:theme-change", { detail: preference }),
  );
}

export function initializeTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(getThemePreference());
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
