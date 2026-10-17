import { app, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  getResourceMode,
  getWorkspacePath,
  setResourceMode,
  setWorkspacePath,
  type ResourceMode,
} from "./settings-store";
import { restartManagedGateway } from "./gateway-process";

const run = (command: string, args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `${command} exited with ${code}.`));
    });
  });

async function workspaceStatus(workspacePath = getWorkspacePath()) {
  if (!workspacePath || !existsSync(workspacePath)) {
    return { path: "", name: "No project selected", git: false, changes: 0 };
  }
  try {
    const status = await run("git", ["status", "--porcelain"], workspacePath);
    return {
      path: workspacePath,
      name: path.basename(workspacePath),
      git: true,
      changes: status.split(/\r?\n/).filter(Boolean).length,
    };
  } catch {
    return { path: workspacePath, name: path.basename(workspacePath), git: false, changes: 0 };
  }
}

export async function createWorkspaceCheckpoint(label: string) {
  const workspacePath = getWorkspacePath();
  const status = await workspaceStatus(workspacePath);
  if (!status.path) throw new Error("Choose a project workspace first.");
  if (!status.git) throw new Error("Checkpoints currently require a Git project.");

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.trim().replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "checkpoint";
  const destination = path.join(app.getPath("userData"), "checkpoints", `${id}-${safeLabel}`);
  mkdirSync(destination, { recursive: true });
  const [diff, revision, untrackedOutput] = await Promise.all([
    run("git", ["diff", "--binary", "HEAD"], workspacePath),
    run("git", ["rev-parse", "HEAD"], workspacePath),
    run("git", ["ls-files", "--others", "--exclude-standard"], workspacePath),
  ]);
  writeFileSync(path.join(destination, "changes.patch"), diff, "utf8");
  const untracked = untrackedOutput.split(/\r?\n/).filter(Boolean);
  let copiedBytes = 0;
  for (const relative of untracked) {
    const source = path.resolve(workspacePath, relative);
    if (!source.startsWith(path.resolve(workspacePath) + path.sep) || !existsSync(source)) continue;
    const info = statSync(source);
    if (!info.isFile() || copiedBytes + info.size > 50 * 1024 * 1024) continue;
    const target = path.join(destination, "untracked", relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    copiedBytes += info.size;
  }
  writeFileSync(
    path.join(destination, "checkpoint.json"),
    JSON.stringify({ id, label: label.trim() || "Checkpoint", workspacePath, revision: revision.trim(), changes: status.changes, untrackedFiles: untracked.length, createdAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  return { id, path: destination, changes: status.changes, untrackedFiles: untracked.length };
}

export function registerWorkspace() {
  ipcMain.handle("workspace:get", () => workspaceStatus());
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Choose project workspace" });
    if (result.canceled || !result.filePaths[0]) return workspaceStatus();
    setWorkspacePath(path.resolve(result.filePaths[0]));
    await restartManagedGateway();
    return workspaceStatus();
  });
  ipcMain.handle("workspace:checkpoint", (_event, label: unknown) => createWorkspaceCheckpoint(typeof label === "string" ? label : "Checkpoint"));
  ipcMain.handle("resources:get", () => ({ mode: getResourceMode() }));
  ipcMain.handle("resources:set", async (_event, mode: unknown) => {
    if (mode !== "low" && mode !== "balanced" && mode !== "performance") throw new Error("Invalid resource mode.");
    setResourceMode(mode as ResourceMode);
    await restartManagedGateway();
    return { mode };
  });
}
