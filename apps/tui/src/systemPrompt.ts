import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function loadSystemPrompt(customPath?: string): string {
  if (customPath?.trim()) {
    try {
      const custom = readFileSync(customPath.trim(), "utf8").trim();
      if (custom) return custom;
    } catch {
      // Fall through to the default prompt.
    }
  }
  const override = process.env.MEMO_SYSTEM_PROMPT;
  if (override?.trim()) return override.trim();
  try {
    const prompt = readFileSync(
      resolve(PROJECT_ROOT, "system.txt"),
      "utf8",
    ).trim();
    if (prompt) return prompt;
  } catch {
    // Fall through to the bundled default.
  }
  return "You are Memo, a helpful assistant.";
}
