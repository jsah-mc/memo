import { app, ipcMain } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 50 * 1024 * 1024;

let database: DatabaseSync | undefined;

function isMemoRoot(candidate: string) {
  const projectFile = path.join(candidate, "pyproject.toml");
  if (!existsSync(projectFile)) return false;

  try {
    const content = readFileSync(projectFile, "utf8");
    return /\bname\s*=\s*["']memo["']/.test(content);
  } catch {
    return false;
  }
}

function findProjectRoot() {
  let candidate = path.resolve(process.cwd());
  let parent = path.dirname(candidate);

  while (parent !== candidate) {
    if (isMemoRoot(candidate)) return candidate;
    candidate = parent;
    parent = path.dirname(candidate);
  }

  if (isMemoRoot(candidate)) return candidate;

  throw new Error(
    "Could not locate Memo's project root. Start the desktop app from inside the Memo repository.",
  );
}

export function chatDatabasePath() {
  const configured = process.env.MEMO_CHAT_DATABASE;
  return configured
    ? path.resolve(configured)
    : path.join(app.isPackaged ? app.getPath("userData") : findProjectRoot(), "data.sqlite");
}

function getDatabase() {
  if (database) return database;

  database = new DatabaseSync(chatDatabasePath());
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS chat_storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

function validateKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH
  ) {
    throw new Error("Invalid chat-history key.");
  }
}

function validateValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) {
    throw new Error("Invalid chat-history value.");
  }
}

export function registerChatHistory() {
  ipcMain.handle("chat-history:get", (_event, key: unknown) => {
    validateKey(key);
    const row = getDatabase()
      .prepare("SELECT value FROM chat_storage WHERE key = ?")
      .get(key) as { value?: unknown } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  });

  ipcMain.handle("chat-history:set", (_event, key: unknown, value: unknown) => {
    validateKey(key);
    validateValue(value);
    getDatabase()
      .prepare(
        `INSERT INTO chat_storage (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, value);
  });

  ipcMain.handle("chat-history:remove", (_event, key: unknown) => {
    validateKey(key);
    getDatabase().prepare("DELETE FROM chat_storage WHERE key = ?").run(key);
  });
}

export function closeChatHistory() {
  database?.close();
  database = undefined;
}
