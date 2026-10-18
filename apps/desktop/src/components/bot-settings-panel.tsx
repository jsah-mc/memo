import { BotIcon, TerminalSquareIcon } from "lucide-react";
import { useAgents } from "@/agents/agent-provider";
import {
  BOT_TOOL_OPTIONS,
  getBotSettings,
  saveBotSettings,
  useBotSettings,
  type BotTool,
} from "@/agents/bot-settings";
import { Input } from "@/components/ui/input";

export function BotSettingsPanel() {
  const { agents, activeAgent, selectAgent } = useAgents();
  const settings = useBotSettings(activeAgent.id, activeAgent.name);
  const profiles = [activeAgent, ...agents].filter(
    (agent, index, values) =>
      values.findIndex((item) => item.id === agent.id) === index,
  );
  const update = (changes: Partial<typeof settings>) =>
    saveBotSettings(activeAgent.id, { ...settings, ...changes });
  const toggleTool = (tool: BotTool, enabled: boolean) =>
    update({
      allowedTools: enabled
        ? [...settings.allowedTools, tool]
        : settings.allowedTools.filter((item) => item !== tool),
    });

  return (
    <section className="grid gap-4">
      <div className="grid gap-2">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
          // BOTS
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {profiles.map((agent) => {
            const bot = getBotSettings(agent.id, agent.name);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectAgent(agent.id)}
                className={`border p-2 text-left font-mono text-xs ${agent.id === activeAgent.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
              >
                <span className="block truncate text-foreground">
                  {bot.name}
                </span>
                <span
                  className={
                    bot.enabled ? "text-primary" : "text-muted-foreground"
                  }
                >
                  {bot.enabled ? "[enabled]" : "[disabled]"} /{bot.command}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="terminal-card flex items-start gap-3 border border-border p-4">
        <BotIcon className="mt-0.5 size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">{activeAgent.name} bot</h3>
              <p className="text-xs text-muted-foreground">
                Apply persistent bot behavior to every conversation with this
                agent.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
                className="size-4 accent-primary"
              />
              Enabled
            </label>
          </div>
        </div>
      </div>

      <label className="grid gap-1.5 text-xs font-medium">
        <span className="text-muted-foreground">Bot name</span>
        <Input
          aria-label="Bot name"
          value={settings.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Builder"
          className="font-mono"
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          CLI: /bot &quot;{settings.name || "name"}&quot;
        </span>
      </label>

      <fieldset className="grid gap-2 border border-border p-3">
        <legend className="px-1 font-mono text-[10px] tracking-wider text-muted-foreground">
          // TOOL ACCESS
        </legend>
        {BOT_TOOL_OPTIONS.map((tool) => (
          <label
            key={tool.id}
            className="flex cursor-pointer items-start gap-3"
          >
            <input
              type="checkbox"
              checked={settings.allowedTools.includes(tool.id)}
              onChange={(event) => toggleTool(tool.id, event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="grid gap-0.5">
              <span className="font-mono text-xs text-foreground">
                {tool.label}
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {tool.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-2 border border-border p-3">
        <legend className="px-1 font-mono text-[10px] tracking-wider text-muted-foreground">
          // PERMISSIONS
        </legend>
        {(
          [
            [
              "full_access",
              "Full access",
              "Approve shell commands and desktop control.",
            ],
            [
              "approve_for_me",
              "Approve for me",
              "Approve shell commands; ask before desktop control.",
            ],
            [
              "always_ask",
              "Always ask",
              "Ask before shell commands and desktop control.",
            ],
          ] as const
        ).map(([value, label, description]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name={`permission-mode-${activeAgent.id}`}
              checked={settings.permissionMode === value}
              onChange={() => update({ permissionMode: value })}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="grid gap-0.5">
              <span className="font-mono text-xs">{label}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="grid gap-1.5 text-xs font-medium">
        <span className="text-muted-foreground">Allowed Composio tools</span>
        <Input
          aria-label="Allowed Composio tools"
          value={settings.allowedComposioTools.join(", ")}
          onChange={(event) =>
            update({
              allowedComposioTools: event.target.value
                .split(",")
                .map((value) => value.trim().toUpperCase())
                .filter(Boolean),
            })
          }
          placeholder="*, GITHUB_CREATE_ISSUE"
          className="font-mono"
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          Comma-separated tool slugs. Use * for every tool in the bot&apos;s
          connected apps.
        </span>
      </label>

      <label className="grid gap-1.5 text-xs font-medium">
        <span className="text-muted-foreground">Allowed MCP servers</span>
        <Input
          aria-label="Allowed MCP servers"
          value={settings.allowedMcpServers.join(", ")}
          onChange={(event) =>
            update({
              allowedMcpServers: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          placeholder="github, filesystem"
          className="font-mono"
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          Server IDs are passed only to runtimes that provide those MCP servers.
        </span>
      </label>

      <label className="grid gap-1.5 text-xs font-medium">
        <span className="flex items-center gap-2 text-muted-foreground">
          <TerminalSquareIcon className="size-4" /> Command name
        </span>
        <div className="flex items-center border border-input bg-background px-2 focus-within:border-ring">
          <span className="font-mono text-sm text-primary">/</span>
          <Input
            aria-label="Bot command name"
            value={settings.command}
            onChange={(event) =>
              update({
                command: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, ""),
              })
            }
            className="border-0 px-1 font-mono focus-visible:ring-0"
          />
        </div>
      </label>

      <label className="grid gap-1.5 text-xs font-medium">
        <span className="text-muted-foreground">Bot instructions</span>
        <textarea
          aria-label="Bot instructions"
          value={settings.instructions}
          onChange={(event) => update({ instructions: event.target.value })}
          rows={7}
          className="resize-y border border-input bg-background p-3 font-mono text-sm leading-relaxed outline-none focus:border-ring"
        />
      </label>

      <p className="border-l-2 border-primary pl-3 font-mono text-xs text-muted-foreground">
        {settings.enabled
          ? `ACTIVE ${settings.name || "bot"} /${settings.command || "bot"} · runs with ${activeAgent.cli} · ${activeAgent.model}`
          : "INACTIVE · enable bot mode to add these instructions to each run"}
      </p>
    </section>
  );
}
