import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps", "desktop");
const outRoot = path.join(desktopRoot, "out");
const bundleRoot = path.join(outRoot, `Memo-${process.platform}-${process.arch}`);
const executable = process.platform === "win32"
  ? path.join(bundleRoot, "Memo.exe")
  : process.platform === "darwin"
    ? path.join(bundleRoot, "Memo.app", "Contents", "MacOS", "Memo")
    : path.join(bundleRoot, "Memo");
const marker = path.join(outRoot, ".memo-source-revision");

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function currentRevision() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function packageDesktop() {
  console.log("Building Memo desktop for the first launch or updated source...");
  const environment = { ...process.env, CI: "true" };
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "build_windows_sandbox.ps1"),
    ]);
    run(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "pnpm --filter @memo/desktop package"],
      { env: environment },
    );
  } else {
    run("pnpm", ["--filter", "@memo/desktop", "package"], {
      env: environment,
    });
  }
  if (!existsSync(executable)) {
    throw new Error(`Desktop build did not create ${executable}`);
  }
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(marker, `${currentRevision()}\n`);
}

function installApplicationLauncher() {
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "install-start-menu.ps1"),
      "-Executable",
      executable,
      "-WorkingDirectory",
      root,
    ]);
    return;
  }

  if (process.platform === "linux") {
    const applications = path.join(os.homedir(), ".local", "share", "applications");
    mkdirSync(applications, { recursive: true });
    writeFileSync(
      path.join(applications, "memo.desktop"),
      `[Desktop Entry]\nName=Memo\nComment=Local AI assistant\nExec="${executable}"\nIcon=${path.join(desktopRoot, "assets", "memo-icon.png")}\nTerminal=false\nType=Application\nCategories=Utility;\n`,
    );
    return;
  }

  if (process.platform === "darwin") {
    const applications = path.join(os.homedir(), "Applications");
    const link = path.join(applications, "Memo.app");
    mkdirSync(applications, { recursive: true });
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
      else return;
    } catch {}
    symlinkSync(path.join(bundleRoot, "Memo.app"), link, "junction");
  }
}

const revision = currentRevision();
const builtRevision = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
if (!existsSync(executable) || builtRevision !== revision) packageDesktop();
installApplicationLauncher();

const child = spawn(executable, [], {
  cwd: root,
  detached: true,
  env: { ...process.env, MEMO_GATEWAY_ROOT: root },
  stdio: "ignore",
});
child.unref();
console.log("Memo desktop is running and is available from the application menu.");
