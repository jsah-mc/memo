import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indicator = readFileSync(
  "apps/desktop/src/electron/desktop-control-indicator.ts",
  "utf8",
);
const chatApi = readFileSync(
  "apps/desktop/src/electron/chat-api.ts",
  "utf8",
);
const actions = readFileSync("utils/tools/cua_actions.py", "utf8");

test("authorized desktop control shows a full-screen click-through control layer", () => {
  assert.match(indicator, /background: rgba\(245, 158, 11, \.055\)/);
  assert.match(indicator, /border: 4px solid #f59e0b/);
  assert.match(indicator, /setIgnoreMouseEvents\(true/);
  assert.match(indicator, /showInactive\(\)/);
  assert.match(chatApi, /startDesktopControlIndicator\(requestId\)/);
  assert.match(chatApi, /stopDesktopControlIndicator\(request\.id\)/);
});

test("desktop control layer renders a cursor across displays", () => {
  assert.match(indicator, /class="agent-cursor"/);
  assert.match(indicator, /screen\.getCursorScreenPoint\(\)/);
  assert.match(indicator, /point\.x - bounds\.x/);
  assert.match(indicator, /point\.y - bounds\.y/);
});

test("host actions share one visible agent cursor session", () => {
  assert.match(actions, /AGENT_CURSOR_SESSION = "memo-agent-control"/);
  assert.ok(
    actions.match(/session=AGENT_CURSOR_SESSION/g)?.length >= 5,
    "every host input action should use the visible cursor session",
  );
});
