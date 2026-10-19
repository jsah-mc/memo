import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AgentDesktopPanel } from "@/agents/agent-desktop-panel";
import Titlebar from "@/components/titlebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RuntimeProvider } from "@/runtime-provider";
import { AgentSetupGate } from "@/agents/agent-setup-gate";
import { AgentProvider, useAgents } from "@/agents/agent-provider";
import { ModelSidebar } from "@/agents/model-sidebar";
import { GatewayStartup } from "@/components/gateway-startup";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import { TaskActivitySidebar } from "@/agents/task-activity-sidebar";
import "./index.css";
import { initializeTheme } from "./theme";
import { AgentGroupProvider } from "@/agents/agent-groups";

function WorkspaceSession() {
  const { activeAgent } = useAgents();
  const [rightPanel, setRightPanel] = useState<"desktop" | "models" | "activity" | null>(
    null,
  );
  return (
    <>
      <Titlebar
        desktopOpen={rightPanel === "desktop"}
        modelOpen={rightPanel === "models"}
        onDesktopToggle={() =>
          setRightPanel((value) => (value === "desktop" ? null : "desktop"))
        }
        onModelToggle={() =>
          setRightPanel((value) => (value === "models" ? null : "models"))
        }
        activityOpen={rightPanel === "activity"}
        onActivityToggle={() => setRightPanel((value) => value === "activity" ? null : "activity")}
      />
      <div className="ml-72 min-w-0 flex-1">
        <App />
      </div>
      {rightPanel === "desktop" && <AgentDesktopPanel agent={activeAgent} />}
      {rightPanel === "models" && <ModelSidebar />}
      {rightPanel === "activity" && <TaskActivitySidebar />}
    </>
  );
}

function WorkspaceShell() {
  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar />
      <RuntimeProvider>
        <WorkspaceShortcuts />
        <WorkspaceSession />
      </RuntimeProvider>
    </SidebarProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Missing renderer mount element: expected <div id="root">.');
}

initializeTheme();

createRoot(rootElement).render(
  <React.StrictMode>
    <GatewayStartup>
      <AgentProvider>
        <AgentGroupProvider>
          <AgentSetupGate>
            <WorkspaceShell />
          </AgentSetupGate>
        </AgentGroupProvider>
      </AgentProvider>
    </GatewayStartup>
  </React.StrictMode>,
);
