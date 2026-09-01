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
    <div className="drag fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-between border-b border-sidebar-border bg-[#181818] px-3 text-xs text-[#cccccc]">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="no-drag size-6 rounded p-1 hover:bg-[#2a2d2e]" />
        <span className="font-mono text-[11px] tracking-wider text-[#858585]">
          VS CODE AGENT // MEMO
        </span>
      </div>
      <div className="pointer-events-none font-sans text-xs font-semibold tracking-wide text-[#cccccc]">
        Agent Workspace
      </div>
      <div className="w-12"></div>
    </div>
  );
}
