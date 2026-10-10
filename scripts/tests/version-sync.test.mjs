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
});

test("published metadata is not placeholder content", () => {
  assert.notEqual(desktop.description, "My application description");
  assert.ok(desktop.description.length > 20);
});
