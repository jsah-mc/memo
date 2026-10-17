import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync("apps/desktop/src/main.tsx", "utf8");
const theme = readFileSync("apps/desktop/src/theme.ts", "utf8");
const settings = readFileSync("apps/desktop/src/components/settings-dialog.tsx", "utf8");
const electron = readFileSync("apps/desktop/src/electron/main.ts", "utf8");
const forge = readFileSync("apps/desktop/forge.config.ts", "utf8");
const asciiAgent = readFileSync("apps/desktop/src/components/ascii-agent.tsx", "utf8");
const thread = readFileSync("apps/desktop/src/components/thread.tsx", "utf8");

test("desktop supports persistent system, light, and dark themes", () => {
  assert.match(main, /initializeTheme\(\)/);
  assert.match(theme, /"system" \| "light" \| "dark"/);
  assert.match(theme, /localStorage\.setItem/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(settings, /AppearancePanel/);
});

test("desktop uses terminal typography and ASCII-only agent animation", () => {
  assert.match(asciiAgent, /memo:\/\/agent/);
  assert.match(asciiAgent, /FRAMES/);
  assert.doesNotMatch(asciiAgent, /[\u2800-\u28ff]/u);
  assert.match(thread, /\/\/ READY FOR INPUT/);
  assert.match(thread, /\$ type a command or message/);
});

test("desktop packages and uses the supplied Memo icon", () => {
  for (const extension of ["png", "ico", "icns", "svg"]) {
    assert.ok(existsSync(`apps/desktop/assets/memo-icon.${extension}`), extension);
  }
  assert.match(forge, /memo-icon/);
  assert.match(forge, /extraResource/);
  assert.match(electron, /nativeImage\.createFromPath\(getAppIconPath\(\)\)/);
});
