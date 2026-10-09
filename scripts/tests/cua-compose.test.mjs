import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("deploy/cua-desktop/Dockerfile", "utf8");
const compose = readFileSync("deploy/cua-desktop/compose.yaml", "utf8");

test("the local desktop uses trycua/cua-xfce with its canonical ports", () => {
  assert.match(dockerfile, /^FROM trycua\/cua-xfce:latest$/m);
  assert.match(compose, /\$\{CUA_PORT:-3211\}:8000/);
  assert.match(compose, /\$\{CUA_VIEWER_PORT:-3212\}:6901/);
});
