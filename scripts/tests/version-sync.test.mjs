import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const desktop = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
const pyproject = readFileSync("pyproject.toml", "utf8");
const pythonVersion = pyproject.match(/^version = "([^"]+)"/m)?.[1];

test("package versions stay synchronized", () => {
  assert.equal(root.version, desktop.version);
  assert.equal(pythonVersion, desktop.version);
  const tauri = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
  assert.equal(tauri.version, desktop.version);
  const cargo = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], desktop.version);
  for (const [file, name] of [["uv.lock", "memo"], ["apps/desktop/src-tauri/Cargo.lock", "memo-desktop"]]) {
    const contents = readFileSync(file, "utf8");
    const pattern = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`);
    assert.equal(contents.match(pattern)?.[1], desktop.version, file);
  }
});

test("published metadata is not placeholder content", () => {
  assert.notEqual(desktop.description, "My application description");
  assert.ok(desktop.description.length > 20);
});
