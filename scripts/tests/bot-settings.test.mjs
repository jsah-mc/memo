import assert from "node:assert/strict";
import test from "node:test";
import { botSystemPrompt } from "../../apps/desktop/src/agents/bot-settings.ts";
import { readFileSync } from "node:fs";

const panel = readFileSync(
  "apps/desktop/src/components/bot-settings-panel.tsx",
  "utf8",
);
const store = readFileSync("apps/desktop/src/electron/bot-store.ts", "utf8");
const settings = readFileSync(
  "apps/desktop/src/agents/bot-settings.ts",
  "utf8",
);
const chatApi = readFileSync("apps/desktop/src/electron/chat-api.ts", "utf8");

test("enabled bot settings reach the agent system prompt", () => {
  const prompt = botSystemPrompt({
    enabled: true,
    name: "Builder",
    command: "builder",
    instructions: "Keep tasks moving.",
    allowedTools: ["browser", "computer"],
    permissionMode: "approve_for_me",
    allowedComposioTools: ["GITHUB_CREATE_ISSUE"],
    allowedMcpServers: ["github"],
  });
  assert.match(prompt, /\/builder/);
  assert.match(prompt, /Builder/);
  assert.match(prompt, /Keep tasks moving\./);
  assert.match(prompt, /browser, computer/);
  assert.match(prompt, /approve_for_me/);
  assert.match(prompt, /GITHUB_CREATE_ISSUE/);
  assert.match(prompt, /github/);
});

test("disabled bot settings leave the normal agent prompt unchanged", () => {
  assert.equal(
    botSystemPrompt({
      enabled: false,
      name: "Builder",
      command: "builder",
      instructions: "Keep tasks moving.",
      allowedTools: [],
      permissionMode: "always_ask",
      allowedComposioTools: [],
      allowedMcpServers: [],
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
  assert.match(panel, /TOOL ACCESS/);
  assert.match(panel, /PERMISSIONS/);
  assert.match(panel, /Allowed Composio tools/);
  assert.match(panel, /Allowed MCP servers/);
  assert.match(chatApi, /memo_sign_in_url/);
  assert.match(chatApi, /shell\.openExternal/);
  for (const tool of ["Browser", "Computer & shell", "Connected apps"]) {
    assert.match(settings, new RegExp(tool));
  }
});
