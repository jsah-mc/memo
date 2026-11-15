import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BOT_TOOL_IDS = ["browser", "computer", "integrations"] as const;
export type BotToolId = (typeof BOT_TOOL_IDS)[number];
export type PermissionMode = "full_access" | "approve_for_me" | "always_ask";

export type Bot = {
  agentId?: string;
  name: string;
  command: string;
  instructions: string;
  enabled: boolean;
  model?: string;
  allowedTools: string[];
  permissionMode: PermissionMode;
  allowedComposioTools: string[];
  allowedComposioApps: string[];
  allowedMcpServers: string[];
};

export const storePath = () => join(homedir(), ".memo", "bots.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function loadBots(path: string = storePath()): Bot[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (bot): bot is Record<string, unknown> =>
        isRecord(bot) &&
        typeof bot.name === "string" &&
        bot.name.trim().length > 0 &&
        typeof bot.instructions === "string" &&
        typeof bot.enabled === "boolean",
    )
    .map((bot) => ({
      ...bot,
      name: bot.name as string,
      command: typeof bot.command === "string" ? bot.command : "bot",
      instructions: bot.instructions as string,
      enabled: bot.enabled as boolean,
      model: typeof bot.model === "string" ? bot.model : undefined,
      allowedTools: (Array.isArray(bot.allowedTools) ? bot.allowedTools : [
        ...BOT_TOOL_IDS,
      ]).filter(
        (tool): tool is string =>
          typeof tool === "string" &&
          (BOT_TOOL_IDS as readonly string[]).includes(tool),
      ),
      permissionMode: (
        ["full_access", "approve_for_me", "always_ask"] as const
      ).includes(bot.permissionMode as PermissionMode)
        ? (bot.permissionMode as PermissionMode)
        : "always_ask",
      allowedComposioTools: Array.isArray(bot.allowedComposioTools)
        ? bot.allowedComposioTools.filter(
            (tool): tool is string => typeof tool === "string",
          )
        : ["*"],
      allowedComposioApps: Array.isArray(bot.allowedComposioApps)
        ? bot.allowedComposioApps.filter(
            (app): app is string => typeof app === "string",
          )
        : ["*"],
      allowedMcpServers: Array.isArray(bot.allowedMcpServers)
        ? bot.allowedMcpServers.filter(
            (server): server is string => typeof server === "string",
          )
        : [],
    }));
}

export function saveBots(bots: Bot[], path: string = storePath()): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(bots, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function upsertBot(bot: Bot, path: string = storePath()): Bot {
  const name = bot.name.trim().toLocaleLowerCase();
  const bots = loadBots(path).filter(
    (existing) => existing.name.trim().toLocaleLowerCase() !== name,
  );
  bots.push(bot);
  saveBots(bots, path);
  return bot;
}

export function findBot(name: string, bots: Bot[]): Bot | undefined {
  const expected = name.trim().toLocaleLowerCase();
  return bots.find(
    (bot) =>
      bot.enabled &&
      (bot.name.trim().toLocaleLowerCase() === expected ||
        (bot.command || "").trim().toLocaleLowerCase() === expected),
  );
}

export function botSlug(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "bot";
}

export function newBotEntry(
  name: string,
  command: string,
  instructions: string,
  model = "",
  apps: string[] = ["*"],
): Bot {
  const trimmedModel = model.trim();
  return {
    name: name.trim(),
    command: botSlug(command.trim() || name),
    instructions: instructions.trim(),
    enabled: true,
    ...(trimmedModel ? { model: trimmedModel } : {}),
    allowedComposioApps: apps.length ? apps : ["*"],
    allowedTools: [...BOT_TOOL_IDS],
    permissionMode: "always_ask",
    allowedComposioTools: ["*"],
    allowedMcpServers: [],
  };
}

export const CODEX_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-6-astra",
] as const;

/** Provider-qualified models that don't need Codex login. */
export const PROVIDER_MODELS = [
  "google/gemini-2.0-flash-exp",
  "google/gemini-1.5-flash",
  "vercel/gpt-live-1",
  "vercel/gpt-4o",
  "vercel/gpt-4o-mini",
  "ollama/llama3.2",
  "ollama/qwen2.5-coder",
  "ollama/deepseek-coder",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "groq/llama-3.3-70b-versatile",
  "openrouter/auto",
  "lmstudio/llama3.2",
] as const;

export const DEFAULT_MODEL = "google/gemini-2.0-flash-exp";

const prefsPath = () => join(homedir(), ".memo", "tui.json");

export function loadModel(path: string = prefsPath()): string {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      isRecord(value) &&
      typeof value.model === "string" &&
      value.model.trim()
    ) {
      return value.model.trim();
    }
  } catch {
    // Missing or unreadable prefs fall back to the default.
  }
  return DEFAULT_MODEL;
}

export function saveModel(model: string, path: string = prefsPath()): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ model }, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function botPrompt(bot: Bot): string {
  return [
    "Memo bot mode is enabled.",
    `Your bot name is ${bot.name.trim()}.`,
    `Your command name is /${bot.command.trim() || "bot"}.`,
    `Allowed tool groups: ${(bot.allowedTools.length ? bot.allowedTools : [...BOT_TOOL_IDS]).join(", ")}.`,
    `Permission mode: ${bot.permissionMode}.`,
    `Allowed Composio tools: ${(bot.allowedComposioTools.length ? bot.allowedComposioTools : ["*"]).join(", ")}.`,
    `Allowed Composio apps: ${(bot.allowedComposioApps.length ? bot.allowedComposioApps : ["*"]).join(", ")}.`,
    `Allowed MCP servers: ${bot.allowedMcpServers.join(", ")}.`,
    bot.instructions.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
