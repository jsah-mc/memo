import { useEffect, useState } from "react";

export type BotSettings = Readonly<{
  enabled: boolean;
  command: string;
  instructions: string;
}>;

const STORAGE_KEY = "memo.bot-settings.v1";
const EVENT_NAME = "memo:bot-settings-change";

const defaults = (agentName = "memo"): BotSettings => ({
  enabled: false,
  command: agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "memo",
  instructions:
    "Act as a persistent task bot. Track the current objective, report progress briefly, and finish with the next useful action.",
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
    ? stored
    : defaults(agentName);
}

export function saveBotSettings(agentId: string, settings: BotSettings) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...readAll(), [agentId]: settings }),
  );
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: agentId }));
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
    `Its command name is /${settings.command}.`,
    settings.instructions.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
