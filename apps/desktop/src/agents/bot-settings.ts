import { useEffect, useState } from "react";

export type BotSettings = Readonly<{
  enabled: boolean;
  name: string;
  command: string;
  instructions: string;
  allowedTools: readonly BotTool[];
}>;

export const BOT_TOOL_OPTIONS = [
  {
    id: "browser",
    label: "Browser",
    description: "Browse and interact with websites.",
  },
  {
    id: "computer",
    label: "Computer & shell",
    description: "Use desktop controls and run local commands.",
  },
  {
    id: "integrations",
    label: "Connected apps",
    description: "Use the agent's connected app integrations.",
  },
] as const;

export type BotTool = (typeof BOT_TOOL_OPTIONS)[number]["id"];
const ALL_BOT_TOOLS = BOT_TOOL_OPTIONS.map((tool) => tool.id);

const STORAGE_KEY = "memo.bot-settings.v1";
const EVENT_NAME = "memo:bot-settings-change";

const defaults = (agentName = "memo"): BotSettings => ({
  enabled: false,
  name: agentName,
  command: agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "memo",
  instructions:
    "Act as a persistent task bot. Track the current objective, report progress briefly, and finish with the next useful action.",
  allowedTools: ALL_BOT_TOOLS,
});

const readAll = (): Record<string, BotSettings> => {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, BotSettings>)
      : {};
  } catch {
    return {};
  }
};

export function getBotSettings(agentId: string, agentName = "memo") {
  const stored = readAll()[agentId];
  return stored &&
    typeof stored.enabled === "boolean" &&
    typeof stored.command === "string" &&
    typeof stored.instructions === "string"
    ? {
        ...stored,
        name:
          typeof stored.name === "string" && stored.name.trim()
            ? stored.name
            : agentName,
        allowedTools: Array.isArray(stored.allowedTools)
          ? stored.allowedTools.filter((tool): tool is BotTool =>
              ALL_BOT_TOOLS.includes(tool as BotTool),
            )
          : ALL_BOT_TOOLS,
      }
    : defaults(agentName);
}

export function saveBotSettings(agentId: string, settings: BotSettings) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...readAll(), [agentId]: settings }),
  );
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: agentId }));
  if (settings.name.trim()) {
    void window.desktopApi.bots
      .save({ agentId, ...settings, name: settings.name.trim() })
      .catch((error: unknown) =>
        console.error("Could not mirror bot settings for the CLI:", error),
      );
  }
}

export function useBotSettings(agentId: string, agentName = "memo") {
  const [settings, setSettings] = useState(() =>
    getBotSettings(agentId, agentName),
  );

  useEffect(() => {
    setSettings(getBotSettings(agentId, agentName));
    const refresh = (event: Event) => {
      const changedAgent = (event as CustomEvent<string>).detail;
      if (!changedAgent || changedAgent === agentId) {
        setSettings(getBotSettings(agentId, agentName));
      }
    };
    window.addEventListener(EVENT_NAME, refresh);
    return () => window.removeEventListener(EVENT_NAME, refresh);
  }, [agentId, agentName]);

  return settings;
}

export function botSystemPrompt(settings: BotSettings) {
  if (!settings.enabled) return "";
  return [
    "Memo bot mode is enabled for this agent.",
    `Its bot name is ${settings.name}.`,
    `Its command name is /${settings.command}.`,
    `Allowed tool groups: ${settings.allowedTools.length ? settings.allowedTools.join(", ") : "none"}.`,
    settings.instructions.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
