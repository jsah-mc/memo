import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeProvider = readFileSync(
  "apps/desktop/src/runtime-provider.tsx",
  "utf8",
);
const modelSidebar = readFileSync(
  "apps/desktop/src/agents/model-sidebar.tsx",
  "utf8",
);
const threadModels = readFileSync(
  "apps/desktop/src/agents/thread-model-provider.tsx",
  "utf8",
);
test("each chat run reads the latest agent runtime and model", () => {
  assert.match(runtimeProvider, /activeAgentRef\.current = effectiveAgent/);
  assert.match(
    runtimeProvider,
    /createModelAdapter\(activeAgentRef\.current\)\.run\(options\)/,
  );
});

test("model sidebar updates only the active agent", () => {
  assert.doesNotMatch(modelSidebar, /This thread|threadModels|threadRuntimes/);
  assert.match(modelSidebar, /updateAgentModel\(activeAgent\.id, model\)/);
  assert.match(modelSidebar, /updateAgentRuntime\(activeAgent\.id, cli/);
});

test("threads retain their runtime and model while the agent default advances", () => {
  assert.match(threadModels, /memo\.thread-agent-models\.v2/);
  assert.match(modelSidebar, /updateAgentModel\(activeAgent\.id, model\)/);
  assert.match(modelSidebar, /setSelection\(key, \{ cli: selectedRuntime, model \}\)/);
  assert.match(modelSidebar, /updateAgentRuntime\(activeAgent\.id, cli/);
  assert.match(modelSidebar, /setSelection\(key, \{ cli, model: option\.defaultModel \}\)/);
});
