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
const bundleRoot = path.join(
  outRoot,
  `Memo-${process.platform}-${process.arch}`,
);
const executable =
  process.platform === "win32"
    ? path.join(bundleRoot, "Memo.exe")
    : process.platform === "darwin"
      ? path.join(bundleRoot, "Memo.app", "Contents", "MacOS", "Memo")
      : path.join(bundleRoot, "Memo");
const marker = path.join(outRoot, ".memo-source-revision");
const buildOnly = process.argv.includes("--build-only");
const ifInstalled = process.argv.includes("--if-installed");
const waitArgument = process.argv.indexOf("--wait-for-pid");
const waitForPid =
  waitArgument >= 0 ? Number(process.argv[waitArgument + 1]) : 0;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForProcessExit(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  for (;;) {
    try {
      process.kill(pid, 0);
      await delay(250);
    } catch {
      return;
    }
  }
}

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
  console.log(
    "Building Memo desktop for the first launch or updated source...",
  );
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
    const version = JSON.parse(
      readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ).version;
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
      "-UninstallScript",
      path.join(root, "scripts", "uninstall.ps1"),
      "-DisplayVersion",
      version,
    ]);
    return;
  }

  if (process.platform === "linux") {
    const applications = path.join(
      os.homedir(),
      ".local",
      "share",
      "applications",
    );
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

await waitForProcessExit(waitForPid);
if (ifInstalled && !existsSync(executable) && !existsSync(marker)) {
  console.log("Memo desktop is not installed; skipping its rebuild.");
  process.exit(0);
}

const revision = currentRevision();
const builtRevision = existsSync(marker)
  ? readFileSync(marker, "utf8").trim()
  : "";
if (!existsSync(executable) || builtRevision !== revision) packageDesktop();
installApplicationLauncher();

if (buildOnly) {
  console.log("Memo desktop is updated.");
  process.exit(0);
}

const child = spawn(executable, [], {
  cwd: root,
  detached: true,
  env: { ...process.env, MEMO_GATEWAY_ROOT: root },
  stdio: "ignore",
});
child.unref();
console.log(
  "Memo desktop is running and is available from the application menu.",
);
