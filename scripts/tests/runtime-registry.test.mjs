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

test("Ollama models are discovered from the installed CLI", () => {
  const models = readFileSync(
    "apps/desktop/src/agents/runtime-models.ts",
    "utf8",
  );
  const createAgent = readFileSync(
    "apps/desktop/src/agents/create-agent-dialog.tsx",
    "utf8",
  );
  assert.match(gateway, /\[executable, "list"\]/);
  assert.match(gateway, /"models": self\.available_models/);
  assert.match(models, /backend\.models/);
  assert.match(createAgent, /runtimeModels\.ollama/);
  assert.doesNotMatch(frontend, /llama3\.3|deepseek-r1/);
});
