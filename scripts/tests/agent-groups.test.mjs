import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const groups = readFileSync("apps/desktop/src/agents/agent-groups.tsx", "utf8");
const runtime = readFileSync("apps/desktop/src/runtime-provider.tsx", "utf8");
const dialog = readFileSync("apps/desktop/src/agents/create-agent-group-dialog.tsx", "utf8");
const editDialog = readFileSync("apps/desktop/src/agents/edit-agent-group-dialog.tsx", "utf8");
const color = readFileSync("apps/desktop/src/agents/agent-color.ts", "utf8");
const workspaceStatus = readFileSync("apps/desktop/src/agents/workspace-status.ts", "utf8");
const activity = readFileSync("apps/desktop/src/agents/task-activity.ts", "utf8");
const activitySidebar = readFileSync("apps/desktop/src/agents/task-activity-sidebar.tsx", "utf8");

test("agents and groups own separate thread namespaces", () => {
  assert.match(runtime, /group\.\$\{activeGroup\.id\}/);
  assert.match(runtime, /agent\.\$\{activeAgent\.id\}/);
  assert.match(runtime, /key=\{target\.scope\}/);
  assert.match(runtime, /memo\\\.agent\\\.memo/);
});

test("running conversations stay mounted while switching workspaces", () => {
  assert.match(runtime, /targets\.map\(\(target\) =>/);
  assert.match(runtime, /target\.scope === activeScope \? "contents" : "hidden"/);
  assert.match(runtime, /<RuntimeSession \{\.\.\.target\}>\{children\}<\/RuntimeSession>/);
  assert.doesNotMatch(runtime, /<RuntimeSession\s+key=\{scope\}/);
});

test("group members collaborate in sequence", () => {
  assert.match(groups, /memberIds/);
  assert.match(dialog, /Choose at least two agents|memberIds\.length >= 2/);
  assert.match(runtime, /Earlier agent replies in this turn/);
  assert.match(runtime, /for \(const member of members\)/);
  assert.match(runtime, /transcript \+=/);
});

test("groups can be renamed and have their membership updated", () => {
  assert.match(groups, /updateGroup/);
  assert.match(groups, /groups\.map/);
  assert.match(editDialog, /Save changes/);
  assert.match(editDialog, /updateGroup\(group\.id, name, memberIds\)/);
});

test("background work reports status and running tasks can be cancelled", () => {
  assert.match(runtime, /setActiveScope\(activeScope\)/);
  assert.match(workspaceStatus, /unread: inactive \? current\.unread \+ 1 : 0/);
  assert.match(workspaceStatus, /Notification\.permission !== "granted"/);
  assert.match(activity, /requestCancel/);
  assert.match(activity, /filter\(\(item\) => item\.status === "running"\)/);
  assert.match(activitySidebar, /desktopApi\.cancelChat\(id\)/);
});

test("profile colors accept arbitrary colors and moderate theme contrast", () => {
  const creator = readFileSync("apps/desktop/src/agents/create-agent-dialog.tsx", "utf8");
  assert.match(creator, /type="color"/);
  assert.match(color, /color-mix\(in srgb/);
  assert.match(color, /var\(--muted-foreground\)/);
});
