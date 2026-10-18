import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const frontend = readFileSync("apps/desktop/src/agents/cli-options.ts", "utf8");
const gateway = readFileSync("utils/gateway/cli_backends.py", "utf8");
const expected = [
  "codex",
  "claude",
  "antigravity",
  "opencode",
  "ollama",
  "lmstudio",
  "grok-build",
  "cursor",
  "hermes",
  "pi",
];

test("frontend and gateway expose every supported agent runtime", () => {
  for (const id of expected) {
    assert.match(
      frontend,
      new RegExp(`id: ["']${id}["']`),
      `${id} missing in UI`,
    );
    assert.match(
      gateway,
      new RegExp(`CLIBackend\\(\\s*["']${id}["']`),
      `${id} missing in gateway`,
    );
  }
});

test("runtime settings expose installation and sign-in actions", () => {
  const panel = readFileSync(
    "apps/desktop/src/components/ai-agents-panel.tsx",
    "utf8",
  );
  const chatApi = readFileSync("apps/desktop/src/electron/chat-api.ts", "utf8");
  assert.match(panel, /openInstallGuide\(backend\.id\)/);
  assert.match(panel, /agents\.signIn\(backend\.id\)/);
  assert.match(panel, /agents\.uninstall\(backend\.id\)/);
  assert.match(chatApi, /agents:open-install-guide/);
  assert.match(chatApi, /agents:sign-in/);
  assert.match(chatApi, /agents:uninstall/);
  assert.match(chatApi, /npm uninstall -g/);
  assert.match(chatApi, /tell application "Terminal"/);
});
