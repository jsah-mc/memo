import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync("apps/desktop/src/main.tsx", "utf8");
const theme = readFileSync("apps/desktop/src/theme.ts", "utf8");
const settings = readFileSync("apps/desktop/src/components/settings-dialog.tsx", "utf8");
const electron = readFileSync("apps/desktop/src/electron/main.ts", "utf8");
const forge = readFileSync("apps/desktop/forge.config.ts", "utf8");
const thread = readFileSync("apps/desktop/src/components/thread.tsx", "utf8");
const styles = readFileSync("apps/desktop/src/index.css", "utf8");
const sidebar = readFileSync("apps/desktop/src/components/app-sidebar.tsx", "utf8");

test("desktop supports persistent system, light, and dark themes", () => {
  assert.match(main, /initializeTheme\(\)/);
  assert.match(theme, /"system"\s*\|[^;]*"light"\s*\|[^;]*"dark"/);
  assert.match(theme, /localStorage\.setItem/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(settings, /AppearancePanel/);
});

test("desktop keeps one shared radius with a warm editorial voice", () => {
  assert.match(styles, /--radius:\s*1\.5rem/);
  assert.match(styles, /--memo-composer-radius:\s*var\(--radius\)/);
  assert.doesNotMatch(styles, /border-radius:\s*0\.2rem/);
  assert.match(styles, /--font-display:/);
  assert.match(styles, /--brand:\s*#/);
  assert.match(thread, /What are we working on\?/);
  assert.match(thread, /Ask Memo anything/);
  assert.match(thread, /font-display/);
  assert.match(sidebar, /bg-brand/);
  assert.doesNotMatch(thread, /READY FOR INPUT|type a command or message/);
  assert.ok(!existsSync("apps/desktop/src/components/ascii-agent.tsx"));
});

test("desktop packages and uses the supplied Memo icon", () => {
  for (const extension of ["png", "ico", "icns", "svg"]) {
    assert.ok(existsSync(`apps/desktop/assets/memo-icon.${extension}`), extension);
  }
  assert.match(forge, /memo-icon/);
  assert.match(forge, /extraResource/);
  assert.match(forge, /appBundleId: "com\.jsah\.memo"/);
  assert.ok(existsSync("apps/desktop/assets/memo-trayTemplate.png"));
  assert.ok(existsSync("apps/desktop/assets/memo-trayTemplate@2x.png"));
  assert.match(electron, /getTrayIconPath/);
  assert.match(electron, /setTemplateImage\(true\)/);
  assert.match(electron, /app\.dock\.setIcon\(getAppIconPath\(\)\)/);
});
