import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/thread-list";

export function AppSidebar() {
  return (
    <Sidebar className="border-0 pt-10 pb-6">
      <SidebarHeader />
      <SidebarContent className="min-h-0 overflow-hidden">
        <SidebarGroup className="min-h-0 flex-1 p-2">
          <div className="chat-scrollbar h-full overflow-y-auto">
            <ThreadList />
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
