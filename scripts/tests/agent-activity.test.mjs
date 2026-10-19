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
  for (const face of ["[o_o]", "[^_^]", "[x_x]", "[.  ]", "[   ]"]) {
    assert.ok(activity.includes(face));
  }
  assert.match(activity, /const SPINNER/);
  assert.doesNotMatch(activity, /[\u2800-\u28ff]/u);
  assert.match(runtime, /setAgentActivity\(agent\.id, "loading"\)/);
  assert.match(runtime, /setAgentActivity\(agent\.id, result === "cancelled"/);
});

test("agent faces replace profile initials in the titlebar and sidebar", () => {
  assert.match(titlebar, /AgentActivityFace/);
  assert.match(sidebar, /AgentActivityFace/);
  assert.doesNotMatch(titlebar, /activeAgent\.name\.slice/);
  assert.doesNotMatch(sidebar, /agent\.name\.slice/);
});

test("deleting an agent requires confirmation", () => {
  assert.match(sidebar, /window\.confirm/);
  assert.match(sidebar, /Are you sure you want to delete/);
});
