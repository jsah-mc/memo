import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopPackage = JSON.parse(
  readFileSync("apps/desktop/package.json", "utf8"),
);
const config = JSON.parse(
  readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const bridge = readFileSync(
  "apps/desktop/src/tauri/desktop-api.ts",
  "utf8",
);

test("Tauri reuses the existing Vite React renderer", () => {
  assert.equal(config.build.devUrl, "http://localhost:5173");
  assert.equal(config.build.frontendDist, "../dist");
  assert.equal(desktopPackage.scripts["tauri:dev"], "tauri dev");
});

test("Tauri bridge covers core chat and gateway operations", () => {
  assert.match(bridge, /\/v1\/chat\/completions/);
  assert.match(bridge, /\/v1\/permissions\//);
  assert.match(bridge, /gateway_status/);
  assert.doesNotMatch(bridge, /from ["']electron["']/);
});
