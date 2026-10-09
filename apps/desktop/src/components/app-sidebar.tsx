import { useState } from "react";
import { MonitorIcon, SearchIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { AgentSidebarSection } from "@/agents/agent-sidebar-section";
import { SettingsDialog } from "@/components/settings-dialog";

export function AppSidebar() {
  const [search, setSearch] = useState("");

  return (
    <Sidebar
      collapsible="none"
      className="liquid-panel drag fixed inset-y-0 left-0 z-[60] [&_a]:no-drag [&_button]:no-drag [&_input]:no-drag [&_textarea]:no-drag"
    >
      <SidebarHeader className="gap-3 px-3 pt-4 pb-2">
        <div className="flex items-center gap-2 px-1 text-sm font-semibold tracking-tight">
          <MonitorIcon className="size-3.5 text-muted-foreground" />
          This computer
        </div>
        <label className="no-drag flex h-9 items-center gap-2 rounded-lg border border-sidebar-border bg-background/35 px-3 text-muted-foreground focus-within:border-primary/45">
          <SearchIcon className="size-3.5 shrink-0" />
          <input
            type="search"
            aria-label="Search agents"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </SidebarHeader>
      <SidebarContent className="min-h-0 overflow-y-auto">
        <AgentSidebarSection search={search} />
      </SidebarContent>
      <SidebarFooter className="no-drag px-2 pb-2">
        <SettingsDialog />
      </SidebarFooter>
    </Sidebar>
  );
}
