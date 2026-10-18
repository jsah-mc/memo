import { ipcMain } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL_IDS = ["browser", "computer", "integrations"] as const;
type StoredBot = {
  agentId: string;
  name: string;
  command: string;
  instructions: string;
  enabled: boolean;
  allowedTools: string[];
};
const storePath = () => path.join(os.homedir(), ".memo", "bots.json");

function readBots(): StoredBot[] {
  try {
    const value: unknown = JSON.parse(readFileSync(storePath(), "utf8"));
    return Array.isArray(value) ? (value as StoredBot[]) : [];
  } catch {
    return [];
  }
}

function validBot(value: unknown): value is StoredBot {
  if (!value || typeof value !== "object") return false;
  const bot = value as Partial<StoredBot>;
  return (
    typeof bot.agentId === "string" &&
    typeof bot.name === "string" &&
    Boolean(bot.name.trim()) &&
    typeof bot.command === "string" &&
    typeof bot.instructions === "string" &&
    typeof bot.enabled === "boolean" &&
    Array.isArray(bot.allowedTools) &&
    bot.allowedTools.every((tool) =>
      TOOL_IDS.includes(tool as (typeof TOOL_IDS)[number]),
    )
  );
}

export function registerBotStore() {
  ipcMain.handle("bots:save", (_event, value: unknown) => {
    if (!validBot(value)) throw new Error("Invalid bot settings.");
    const bots = readBots();
    const duplicate = bots.find(
      (item) =>
        item.agentId !== value.agentId &&
        item.name.trim().toLocaleLowerCase() ===
          value.name.trim().toLocaleLowerCase(),
    );
    if (duplicate)
      throw new Error(`A bot named "${value.name.trim()}" already exists.`);
    const updated = [
      ...bots.filter((item) => item.agentId !== value.agentId),
      { ...value, name: value.name.trim() },
    ];
    const destination = storePath();
    mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    renameSync(temporary, destination);
    return { saved: true };
  });
}
