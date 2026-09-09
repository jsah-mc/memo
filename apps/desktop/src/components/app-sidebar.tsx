import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { AgentSidebarSection } from "@/agents/agent-sidebar-section";
import { SettingsDialog } from "@/components/settings-dialog";

export function AppSidebar() {
  return (
    <Sidebar
      collapsible="none"
      className="liquid-panel drag fixed inset-y-0 left-0 z-[60] [&_a]:no-drag [&_button]:no-drag [&_input]:no-drag [&_textarea]:no-drag"
    >
      <SidebarHeader />
      <SidebarContent className="min-h-0 overflow-y-auto">
        <AgentSidebarSection />
      </SidebarContent>
      <SidebarFooter className="no-drag px-2 pb-2">
        <SettingsDialog />
      </SidebarFooter>
    </Sidebar>
  );
}
