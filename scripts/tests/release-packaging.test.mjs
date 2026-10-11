import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const workflow = readFileSync(".github/workflows/release.yml", "utf8");

test("desktop installers bundle the native Memo CLI", () => {
  assert.ok(config.bundle.externalBin.includes("binaries/memo"));
});

test("release prepares the CLI before building installers", () => {
  const build = workflow.indexOf("- name: Build native CLI");
  const prepare = workflow.indexOf("- name: Prepare CLI for installers");
  const installers = workflow.indexOf("- name: Build installers");

  assert.ok(build >= 0);
  assert.ok(prepare > build);
  assert.ok(installers > prepare);
  assert.doesNotMatch(workflow, /- name: Package native CLI/);
});
