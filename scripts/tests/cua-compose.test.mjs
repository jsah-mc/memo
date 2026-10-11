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

test("the desktop image includes apps required for useful CUA workflows", () => {
  for (const packageName of [
    "at-spi2-core",
    "evince",
    "galculator",
    "libreoffice-calc",
    "libreoffice-impress",
    "libreoffice-writer",
    "mousepad",
    "thunar",
    "xclip",
    "xfce4-terminal",
  ]) {
    assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`));
  }
  assert.match(dockerfile, /chromium chromium-browser firefox-esr firefox/);
  assert.match(dockerfile, /GTK_MODULES=gail:atk-bridge/);
});

test("compose waits for the authenticated CUA service to become healthy", () => {
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /Authorization: Bearer \$\$\{CUA_ENV_TOKEN\}/);
  assert.match(compose, /127\.0\.0\.1:8000\/health/);
});
