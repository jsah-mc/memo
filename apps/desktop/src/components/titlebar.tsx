import { useEffect } from "react";
import { SidebarTrigger } from "./ui/sidebar";

export default function Titlebar() {
  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle("dark", isDark);
      window.windowButtons.setTitlebarTheme(isDark);
    };

    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      applySystemTheme(event.matches);
    };

    applySystemTheme(systemTheme.matches);
    systemTheme.addEventListener("change", handleSystemThemeChange);

    return () =>
      systemTheme.removeEventListener("change", handleSystemThemeChange);
  }, []);

  return (
    <div className="drag fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-center bg-sidebar text-foreground">
      <SidebarTrigger className="no-drag absolute left-2 top-1 size-8" />
      <div className="pointer-events-none text-center text-sm font-medium">
        Memo
      </div>
    </div>
  );
}
