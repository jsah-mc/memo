import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activity = readFileSync(
  "apps/desktop/src/agents/agent-activity.tsx",
  "utf8",
);
const runtime = readFileSync("apps/desktop/src/runtime-provider.tsx", "utf8");
const titlebar = readFileSync(
  "apps/desktop/src/components/titlebar.tsx",
  "utf8",
);
const sidebar = readFileSync(
  "apps/desktop/src/agents/agent-sidebar-section.tsx",
  "utf8",
);

test("desktop agent faces reflect the real stream lifecycle", () => {
  for (const face of [':P', ':)', ':(', '⠋', '⠏']) {
    assert.ok(activity.includes(face));
  }
  assert.match(runtime, /setAgentActivity\(agent\.id, "loading"\)/);
  assert.match(runtime, /setAgentActivity\(agent\.id, abortSignal\.aborted/);
});

test("agent faces replace profile initials in the titlebar and sidebar", () => {
  assert.match(titlebar, /AgentActivityFace/);
  assert.match(sidebar, /AgentActivityFace/);
  assert.doesNotMatch(titlebar, /activeAgent\.name\.slice/);
  assert.doesNotMatch(sidebar, /agent\.name\.slice/);
});
