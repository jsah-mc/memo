import { app, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const GATEWAY_BASE_URL = "http://127.0.0.1:4000";
const GATEWAY_URL = `${GATEWAY_BASE_URL}/health/liveliness`;
const STARTUP_TIMEOUT_MS = 30_000;
const RESTART_BACKOFF_MS = 5_000;

export type GatewayStatus = {
  state: "connecting" | "online" | "offline" | "error";
  running: boolean;
  latencyMs: number | null;
  message?: string;
};

let status: GatewayStatus = {
  state: "offline",
  running: false,
  latencyMs: null,
};
let managedGateway: ChildProcess | null = null;
let startup: Promise<void> | null = null;
let lastStartAttempt = 0;
let quitting = false;

function isMemoRoot(candidate: string) {
  const projectFile = path.join(candidate, "pyproject.toml");
  if (!existsSync(projectFile)) return false;

  try {
    return /\bname\s*=\s*["']memo["']/.test(
      readFileSync(projectFile, "utf8"),
    );
  } catch {
    return false;
  }
}

function walkToMemoRoot(start: string) {
  let candidate = path.resolve(start);
  let parent = path.dirname(candidate);

  while (parent !== candidate) {
    if (isMemoRoot(candidate)) return candidate;
    candidate = parent;
    parent = path.dirname(candidate);
  }
  return isMemoRoot(candidate) ? candidate : null;
}

function findMemoRoot() {
  const candidates = [
    process.env.MEMO_GATEWAY_ROOT,
    process.cwd(),
    app.getAppPath(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const root = walkToMemoRoot(candidate);
    if (root) return root;
  }

  throw new Error(
    "Could not locate the Memo gateway. Set MEMO_GATEWAY_ROOT to the repository path.",
  );
}

function gatewayCommand(root: string) {
  const configuredPython = process.env.MEMO_GATEWAY_PYTHON;
  const pythonCandidates = [
    configuredPython,
    process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const python = pythonCandidates.find(existsSync);
  if (python) {
    return {
      command: python,
      args: [path.join(root, "main.py"), "gateway"],
    };
  }

  return {
    command: process.platform === "win32" ? "uv.exe" : "uv",
    args: ["run", "memo", "gateway"],
  };
}

async function probeGateway(timeout = 1_000): Promise<GatewayStatus> {
  const startedAt = performance.now();
  try {
    const response = await fetch(GATEWAY_URL, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      return {
        state: "offline",
        running: false,
        latencyMs: null,
        message: `Gateway health check returned ${response.status}.`,
      };
    }
    return {
      state: "online",
      running: true,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { state: "offline", running: false, latencyMs: null };
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function startGateway() {
  const existing = await probeGateway();
  if (existing.running) {
    status = existing;
    return;
  }

  status = { state: "connecting", running: false, latencyMs: null };
  lastStartAttempt = Date.now();

  let root: string;
  try {
    root = findMemoRoot();
  } catch (error) {
    status = {
      state: "error",
      running: false,
      latencyMs: null,
      message: error instanceof Error ? error.message : String(error),
    };
    return;
  }

  const { command, args } = gatewayCommand(root);
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: "ignore",
  });
  managedGateway = child;

  child.once("error", (error) => {
    if (managedGateway === child) managedGateway = null;
    status = {
      state: "error",
      running: false,
      latencyMs: null,
      message: `Gateway failed to start: ${error.message}`,
    };
  });
  child.once("exit", (code, signal) => {
    if (managedGateway === child) managedGateway = null;
    if (quitting) return;
    status = {
      state: code === 0 ? "offline" : "error",
      running: false,
      latencyMs: null,
      message:
        code === 0
          ? "Gateway stopped."
          : `Gateway exited (${signal ?? code ?? "unknown"}).`,
    };
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && managedGateway === child) {
    const current = await probeGateway();
    if (current.running) {
      status = current;
      return;
    }
    await wait(250);
  }

  if (managedGateway === child) {
    child.kill();
    managedGateway = null;
    status = {
      state: "error",
      running: false,
      latencyMs: null,
      message: "Gateway did not become ready within 30 seconds.",
    };
  }
}

export async function ensureGatewayRunning() {
  if (!startup) {
    if (
      status.state === "error" &&
      Date.now() - lastStartAttempt < RESTART_BACKOFF_MS
    ) {
      throw new Error(status.message ?? "Gateway startup failed.");
    }

    startup = startGateway().finally(() => {
      startup = null;
    });
  }

  await startup;
  const current = await probeGateway(2_000);
  if (!current.running) {
    throw new Error(
      status.message ?? current.message ?? "Memo gateway is not available.",
    );
  }
  status = current;
}

export function registerGatewayLifecycle() {
  ipcMain.handle("gateway:status", async () => {
    const current = await probeGateway();
    if (current.running) {
      status = current;
    } else if (status.state === "online") {
      status = current;
    }

    if (
      !current.running &&
      status.state !== "connecting" &&
      Date.now() - lastStartAttempt >= RESTART_BACKOFF_MS
    ) {
      void ensureGatewayRunning();
      status = { state: "connecting", running: false, latencyMs: null };
    }

    return status;
  });
}

export function stopManagedGateway() {
  quitting = true;
  managedGateway?.kill();
  managedGateway = null;
}
