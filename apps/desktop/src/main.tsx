import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Titlebar from "@/components/titlebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RuntimeProvider } from "@/runtime-provider";
import { Statusbar } from "@/components/statusbar";
import { PermissionDialog } from "@/components/permission-dialog";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Missing renderer mount element: expected <div id="root">.');
}

document.documentElement.classList.toggle(
  "dark",
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);

createRoot(rootElement).render(
  <React.StrictMode>
    <RuntimeProvider>
      <PermissionDialog />
      <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
        <Titlebar />
        <AppSidebar />
        <div className="min-w-0 flex-1 pb-6">
          <App />
        </div>
        <Statusbar />
      </SidebarProvider>
    </RuntimeProvider>
  </React.StrictMode>,
);
