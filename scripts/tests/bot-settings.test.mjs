import assert from "node:assert/strict";
import test from "node:test";
import { botSystemPrompt } from "../../apps/desktop/src/agents/bot-settings.ts";

test("enabled bot settings reach the agent system prompt", () => {
  const prompt = botSystemPrompt({
    enabled: true,
    command: "builder",
    instructions: "Keep tasks moving.",
  });
  assert.match(prompt, /\/builder/);
  assert.match(prompt, /Keep tasks moving\./);
});

test("disabled bot settings leave the normal agent prompt unchanged", () => {
  assert.equal(
    botSystemPrompt({
      enabled: false,
      command: "builder",
      instructions: "Keep tasks moving.",
    }),
    "",
  );
});
