import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateRunning = false;

function sourceRoot() {
  const configured = process.env.MEMO_GATEWAY_ROOT;
  const candidates = [configured, process.cwd(), app.getAppPath()].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const start of candidates) {
    let candidate = path.resolve(start);
    while (path.dirname(candidate) !== candidate) {
      if (existsSync(path.join(candidate, ".git")) && existsSync(path.join(candidate, "pyproject.toml"))) {
        return candidate;
      }
      candidate = path.dirname(candidate);
    }
  }
  throw new Error("Memo's managed source checkout could not be found.");
}

async function run(program: string, args: string[], cwd: string) {
  return exec(program, args, {
    cwd,
    env: { ...process.env, CI: "true" },
    windowsHide: true,
    timeout: 15 * 60 * 1000,
  });
}

async function installPnpmDependencies(root: string) {
  if (process.platform !== "win32") {
    await run("pnpm", ["install", "--frozen-lockfile"], root);
    return;
  }
  await run(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "pnpm install --frozen-lockfile"],
    root,
  );
}

export async function checkForSourceUpdate() {
  const root = sourceRoot();
  await run("git", ["fetch", "--quiet", "origin", "main"], root);
  const { stdout } = await run("git", ["rev-list", "--count", "HEAD..origin/main"], root);
  return { available: Number.parseInt(stdout.trim(), 10) > 0 };
}

export async function installSourceUpdate() {
  if (updateRunning) return;
  updateRunning = true;
  const root = sourceRoot();
  try {
    const dirty = await run("git", ["status", "--porcelain"], root);
    if (dirty.stdout.trim()) {
      throw new Error("Memo has local source changes. Commit or remove them before updating.");
    }
    await run("git", ["pull", "--ff-only", "origin", "main"], root);
    await run(process.platform === "win32" ? "uv.exe" : "uv", ["sync", "--locked"], root);
    await installPnpmDependencies(root);
    app.relaunch();
    app.exit(0);
  } finally {
    updateRunning = false;
  }
}

export function registerSourceUpdater() {
  ipcMain.handle("update:check", checkForSourceUpdate);
  ipcMain.handle("update:install", installSourceUpdate);

  const notify = async () => {
    try {
      if (!(await checkForSourceUpdate()).available) return;
      const owner = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showMessageBox(owner, {
        type: "info",
        title: "Memo update available",
        message: "A new Memo update is available.",
        detail: "Memo will update its managed source checkout and dependencies, then restart.",
        buttons: ["Update and restart", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) await installSourceUpdate();
    } catch (error) {
      console.warn("Memo update check failed:", error);
    }
  };
  setTimeout(() => void notify(), 15_000);
  setInterval(() => void notify(), UPDATE_INTERVAL_MS).unref();
}
