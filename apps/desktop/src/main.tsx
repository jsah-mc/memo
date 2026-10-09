import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AgentDesktopPanel } from "@/agents/agent-desktop-panel";
import Titlebar from "@/components/titlebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RuntimeProvider } from "@/runtime-provider";
import { PermissionDialog } from "@/components/permission-dialog";
import { AgentSetupGate } from "@/agents/agent-setup-gate";
import { AgentProvider, useAgents } from "@/agents/agent-provider";
import { ModelSidebar } from "@/agents/model-sidebar";
import { ThreadModelProvider } from "@/agents/thread-model-provider";
import { GatewayStartup } from "@/components/gateway-startup";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import "./index.css";

function WorkspaceShell() {
  const { activeAgent } = useAgents();
  const [rightPanel, setRightPanel] = useState<"desktop" | "models" | null>(
    null,
  );
  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <Titlebar
        desktopOpen={rightPanel === "desktop"}
        modelOpen={rightPanel === "models"}
        onDesktopToggle={() =>
          setRightPanel((value) => (value === "desktop" ? null : "desktop"))
        }
        onModelToggle={() =>
          setRightPanel((value) => (value === "models" ? null : "models"))
        }
      />
      <AppSidebar />
      <div className="ml-72 min-w-0 flex-1">
        <App />
      </div>
      {rightPanel === "desktop" && <AgentDesktopPanel agent={activeAgent} />}
      {rightPanel === "models" && <ModelSidebar />}
    </SidebarProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Missing renderer mount element: expected <div id="root">.');
}

document.documentElement.classList.add("dark");

createRoot(rootElement).render(
  <React.StrictMode>
    <GatewayStartup>
      <AgentProvider>
        <ThreadModelProvider>
          <AgentSetupGate>
            <RuntimeProvider>
              <WorkspaceShortcuts />
              <PermissionDialog />
              <WorkspaceShell />
            </RuntimeProvider>
          </AgentSetupGate>
        </ThreadModelProvider>
      </AgentProvider>
    </GatewayStartup>
  </React.StrictMode>,
);
