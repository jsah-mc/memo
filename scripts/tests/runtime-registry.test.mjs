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
      new RegExp(`CLIBackend\\(["']${id}["']`),
      `${id} missing in gateway`,
    );
  }
});
