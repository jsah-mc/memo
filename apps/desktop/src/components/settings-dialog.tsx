import { useState } from "react";
import {
  AppWindowIcon,
  BotIcon,
  CloudIcon,
  PackageIcon,
  FolderKanbanIcon,
  GaugeIcon,
  KeyRoundIcon,
  SettingsIcon,
} from "lucide-react";
import { AiAgentsPanel } from "@/components/ai-agents-panel";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import { ComposioPanel } from "@/components/composio-panel";
import { SystemHealthPanel } from "@/components/system-health-panel";
import { VirtualDesktopPanel } from "@/components/virtual-desktop-panel";
import { ResourceSettingsPanel } from "@/components/resource-settings-panel";
import { WorkspaceSettingsPanel } from "@/components/workspace-settings-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SettingsDialog() {
  const [section, setSection] = useState<
    "general" | "resources" | "workspace" | "computer" | "vps" | "agents" | "keys" | "apps"
  >("general");
  const sections = [
    { id: "general" as const, label: "General", icon: SettingsIcon },
    { id: "resources" as const, label: "Resources", icon: GaugeIcon },
    { id: "workspace" as const, label: "Project workspace", icon: FolderKanbanIcon },
    { id: "computer" as const, label: "Local VM", icon: PackageIcon },
    { id: "vps" as const, label: "VPS", icon: CloudIcon },
    { id: "agents" as const, label: "AI agents", icon: BotIcon },
    { id: "keys" as const, label: "API keys", icon: KeyRoundIcon },
    { id: "apps" as const, label: "App connections", icon: AppWindowIcon },
  ];
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="h-9 w-full justify-start gap-2.5 px-2.5"
            aria-label="Open settings"
          />
        }
      >
        <SettingsIcon className="size-4" /> Settings
      </DialogTrigger>
      <DialogContent className="h-[680px] max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="grid h-full min-h-0 grid-cols-[190px_1fr]">
          <aside className="border-r border-border/60 bg-muted/20 p-3 pt-12">
            <nav className="grid gap-1" aria-label="Settings sections">
              {sections.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={`flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm ${section === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>
          <div className="min-h-0 overflow-y-auto p-6">
            <DialogHeader className="mb-5 text-left">
              <DialogTitle>
                {sections.find((item) => item.id === section)?.label}
              </DialogTitle>
              <DialogDescription>
                {section === "general" && "Gateway and provider readiness."}
                {section === "computer" &&
                  "Configure the shared Local VM used by agents."}
                {section === "vps" &&
                  "Configure a separate remote VPS desktop connection."}
                {section === "resources" && "Control CPU use and idle model retention."}
                {section === "workspace" && "Choose a project and create safe checkpoints."}
                {section === "agents" &&
                  "Connect and inspect AI agent runtimes."}
                {section === "keys" && "Manage encrypted service credentials."}
                {section === "apps" && "Connect external apps and services."}
              </DialogDescription>
            </DialogHeader>
            {section === "general" && <SystemHealthPanel />}
            {section === "resources" && <ResourceSettingsPanel />}
            {section === "workspace" && <WorkspaceSettingsPanel />}
            {section === "computer" && <VirtualDesktopPanel />}
            {section === "vps" && <VirtualDesktopPanel target="vps" />}
            {section === "agents" && <AiAgentsPanel />}
            {section === "keys" && <ApiKeysPanel />}
            {section === "apps" && <ComposioPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
