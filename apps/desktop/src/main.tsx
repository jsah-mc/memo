import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Titlebar from "@/components/titlebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RuntimeProvider } from "@/runtime-provider";
import { PermissionDialog } from "@/components/permission-dialog";
import { AgentProvider } from "@/agents/agent-provider";
import { GatewayStartup } from "@/components/gateway-startup";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Missing renderer mount element: expected <div id="root">.');
}

document.documentElement.classList.add("dark");

createRoot(rootElement).render(
  <React.StrictMode>
    <GatewayStartup>
    <AgentProvider>
      <RuntimeProvider>
        <PermissionDialog />
        <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
          <Titlebar />
          <AppSidebar />
          <div className="ml-72 min-w-0 flex-1">
            <App />
          </div>
        </SidebarProvider>
      </RuntimeProvider>
    </AgentProvider>
    </GatewayStartup>
  </React.StrictMode>,
);
