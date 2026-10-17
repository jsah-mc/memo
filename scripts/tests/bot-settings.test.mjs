import assert from "node:assert/strict";
import test from "node:test";
import { botSystemPrompt } from "../../apps/desktop/src/agents/bot-settings.ts";
import { readFileSync } from "node:fs";

const panel = readFileSync("apps/desktop/src/components/bot-settings-panel.tsx", "utf8");
const store = readFileSync("apps/desktop/src/electron/bot-store.ts", "utf8");

test("enabled bot settings reach the agent system prompt", () => {
  const prompt = botSystemPrompt({
    enabled: true,
    name: "Builder",
    command: "builder",
    instructions: "Keep tasks moving.",
  });
  assert.match(prompt, /\/builder/);
  assert.match(prompt, /Builder/);
  assert.match(prompt, /Keep tasks moving\./);
});

test("disabled bot settings leave the normal agent prompt unchanged", () => {
  assert.equal(
    botSystemPrompt({
      enabled: false,
      name: "Builder",
      command: "builder",
      instructions: "Keep tasks moving.",
    }),
    "",
  );
});

test("bot settings manage names and mirror bots for the CLI", () => {
  assert.match(panel, /aria-label="Bot name"/);
  assert.match(panel, /\/bot &quot;/);
  assert.match(panel, /\/\/ BOTS/);
  assert.match(store, /\.memo.*bots\.json/s);
  assert.match(store, /A bot named/);
});
