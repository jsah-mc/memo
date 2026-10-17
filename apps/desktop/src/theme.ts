export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "memo.theme";

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): "light" | "dark" {
  return preference === "system"
    ? prefersDark
      ? "dark"
      : "light"
    : preference;
}

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(preference: ThemePreference): void {
  const dark = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  ) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent("memo:theme-change", { detail: preference }));
}

export function initializeTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(getThemePreference());
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
