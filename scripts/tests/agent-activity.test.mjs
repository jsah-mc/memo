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

test("desktop agent indicators reflect the real stream lifecycle", () => {
  assert.match(activity, /AgentActivityDot/);
  assert.match(activity, /animate-pulse/);
  for (const face of ["[o_o]", "[^_^]", "[x_x]", "[.  ]"]) {
    assert.ok(!activity.includes(face));
  }
  assert.match(runtime, /setAgentActivity\(agent\.id, "loading"\)/);
  assert.match(runtime, /setAgentActivity\(agent\.id, result === "cancelled"/);
});

test("activity dots replace profile initials in the titlebar and sidebar", () => {
  assert.match(titlebar, /AgentActivityDot/);
  assert.match(sidebar, /AgentActivityDot/);
  assert.doesNotMatch(titlebar, /activeAgent\.name\.slice/);
  assert.doesNotMatch(sidebar, /agent\.name\.slice/);
});

test("deleting an agent requires confirmation", () => {
  assert.match(sidebar, /window\.confirm/);
  assert.match(sidebar, /Are you sure you want to delete/);
});
