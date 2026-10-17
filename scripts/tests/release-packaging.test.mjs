import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const windows = readFileSync("scripts/install.ps1", "utf8");
const posix = readFileSync("scripts/install.sh", "utf8");

test("release publishes source bootstrap installers", () => {
  assert.match(workflow, /scripts\/install\.ps1/);
  assert.match(workflow, /scripts\/install\.sh/);
  assert.doesNotMatch(workflow, /cargo|tauri/i);
});

test("installers clone Memo into the managed app directory", () => {
  assert.match(windows, /\.memo/);
  assert.match(windows, /git clone/);
  assert.match(windows, /uv sync --locked/);
  assert.match(windows, /pnpm install --frozen-lockfile/);
  assert.match(posix, /\.memo/);
  assert.match(posix, /git clone/);
  assert.match(posix, /uv sync --locked/);
  assert.match(posix, /pnpm install --frozen-lockfile/);
});
