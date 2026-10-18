import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const windows = readFileSync("scripts/install.ps1", "utf8");
const posix = readFileSync("scripts/install.sh", "utf8");
const desktop = readFileSync("scripts/launch-desktop.mjs", "utf8");
const uninstaller = readFileSync("scripts/uninstall.ps1", "utf8");

test("repository keeps source bootstrap installers without release publishing", () => {
  assert.match(workflow, /scripts\/install\.ps1/);
  assert.match(workflow, /scripts\/install\.sh/);
  assert.doesNotMatch(
    workflow,
    /action-gh-release|upload-artifact|download-artifact/,
  );
  assert.doesNotMatch(workflow, /cargo|tauri/i);
});

test("installers clone Memo into the managed app directory", () => {
  assert.match(windows, /\.memo/);
  assert.match(windows, /git clone/);
  assert.match(windows, /uv sync --locked/);
  assert.match(windows, /pnpm install --frozen-lockfile/);
  assert.match(windows, /memo\.cmd/);
  assert.match(windows, /SetEnvironmentVariable\("Path"/);
  assert.match(windows, /install-start-menu\.ps1/);
  assert.match(windows, /-Arguments "desktop"/);
  assert.match(windows, /"uninstall"/);
  assert.match(windows, /-UninstallScript/);
  assert.doesNotMatch(windows, /build_windows_sandbox/);
  assert.match(posix, /\.memo/);
  assert.match(posix, /git clone/);
  assert.match(posix, /uv sync --locked/);
  assert.match(posix, /pnpm install --frozen-lockfile/);
  assert.match(posix, /portaudio/);
  assert.match(posix, /MEMO_BIN}\/memo/);
  assert.match(posix, /\.memo\/bin/);
  assert.doesNotMatch(posix, /memo-desktop/);
});

test("Windows registers Memo as an installed app with safe removal", () => {
  const registration = readFileSync("scripts/install-start-menu.ps1", "utf8");
  assert.match(registration, /CurrentVersion\\Uninstall\\Memo/);
  assert.match(registration, /QuietUninstallString/);
  assert.match(uninstaller, /Join-Path.*Memo\.lnk/);
  assert.match(uninstaller, /Remove-Item -LiteralPath \$Shortcut/);
  assert.match(uninstaller, /SetEnvironmentVariable\("Path"/);
  assert.match(uninstaller, /memo-uninstall-/);
});

test("memo desktop builds on demand and installs an application launcher", () => {
  assert.match(desktop, /@memo\/desktop.*package/s);
  assert.match(desktop, /\.memo-source-revision/);
  assert.match(desktop, /install-start-menu\.ps1/);
  assert.match(desktop, /memo\.desktop/);
  assert.match(desktop, /Memo\.app/);
  assert.match(desktop, /--build-only/);
  assert.match(desktop, /--wait-for-pid/);
});
