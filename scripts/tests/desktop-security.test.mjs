import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync("apps/desktop/src/electron/main.ts", "utf8");
const preload = readFileSync("apps/desktop/src/electron/preload.ts", "utf8");
const chatApi = readFileSync("apps/desktop/src/electron/chat-api.ts", "utf8");

test("Electron renderer is isolated and sandboxed", () => {
  for (const setting of [
    "contextIsolation: true",
    "nodeIntegration: false",
    "sandbox: true",
    "webSecurity: true",
  ]) {
    assert.match(main, new RegExp(setting));
  }
  assert.match(main, /Content-Security-Policy/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
});

test("health uses fixed context-bridge and IPC channels", () => {
  assert.match(
    preload,
    /getSystemHealth: \(\) => ipcRenderer\.invoke\("system:health"\)/,
  );
  assert.match(chatApi, /ipcMain\.handle\("system:health"/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(\s*[a-zA-Z_$]/);
});

test("launching Memo again restores and focuses its existing window", () => {
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance", showMainWindow\)/);
  assert.match(main, /if \(win\.isMinimized\(\)\) win\.restore\(\)/);
  assert.match(main, /win\.show\(\)/);
  assert.match(main, /win\.focus\(\)/);
});
