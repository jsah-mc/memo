import { app, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  getComposioKey,
  getComposioUserId,
  getComputerSettings,
  getResourceMode,
  getWorkspacePath,
} from "./settings-store";
import { bundledGatewayLaunch } from "./gateway-runtime";

const DESKTOP_GATEWAY_PORT = process.env.MEMO_DESKTOP_GATEWAY_PORT ?? "4010";
export const GATEWAY_BASE_URL = `http://127.0.0.1:${DESKTOP_GATEWAY_PORT}`;
const GATEWAY_URL = `${GATEWAY_BASE_URL}/health/liveliness`;
const STARTUP_TIMEOUT_MS = 90_000;
const RESTART_BACKOFF_MS = 5_000;
const ONLINE_PROBE_CACHE_MS = 5_000;
const OFFLINE_PROBE_CACHE_MS = 250;

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
let lastGatewayError = "";
let lastProbeAt = 0;
let lastProbe: GatewayStatus | null = null;
let probeInFlight: Promise<GatewayStatus> | null = null;

function managedGatewayIsAlive() {
  return managedGateway !== null && managedGateway.exitCode === null;
}

function rememberGatewayError(chunk: Buffer | string) {
  lastGatewayError = `${lastGatewayError}${String(chunk)}`.slice(-4_000).trim();
}

function isMemoRoot(candidate: string) {
  const projectFile = path.join(candidate, "pyproject.toml");
  if (!existsSync(projectFile)) return false;

  try {
    return /\bname\s*=\s*["']memo["']/.test(readFileSync(projectFile, "utf8"));
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

function resourceEnvironment() {
  const mode = getResourceMode();
  const threads = mode === "low" ? "2" : mode === "performance" ? "8" : "4";
  return {
    MEMO_RESOURCE_MODE: mode,
    MEMO_SPEECH_CPU_THREADS: threads,
    OMP_NUM_THREADS: threads,
    OPENBLAS_NUM_THREADS: threads,
    MKL_NUM_THREADS: threads,
    MEMO_SPEECH_IDLE_TIMEOUT_SECONDS:
      mode === "low" ? "10" : mode === "performance" ? "90" : "30",
  };
}

async function runGatewayProbe(timeout: number): Promise<GatewayStatus> {
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
    const payload = (await response.json()) as {
      memo_api_version?: unknown;
      desktop_control?: unknown;
    };
    if (payload.memo_api_version !== 2 || payload.desktop_control !== true) {
      return {
        state: "error",
        running: false,
        latencyMs: null,
        message:
          "A gateway is running on the desktop port, but it does not support Memo computer control.",
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

async function probeGateway(
  timeout = 1_000,
  { force = false }: { force?: boolean } = {},
): Promise<GatewayStatus> {
  const cacheLifetime = lastProbe?.running
    ? ONLINE_PROBE_CACHE_MS
    : OFFLINE_PROBE_CACHE_MS;
  if (!force && lastProbe && Date.now() - lastProbeAt < cacheLifetime) {
    return lastProbe;
  }
  if (probeInFlight) return probeInFlight;

  probeInFlight = runGatewayProbe(timeout)
    .then((result) => {
      lastProbe = result;
      lastProbeAt = Date.now();
      return result;
    })
    .finally(() => {
      probeInFlight = null;
    });
  return probeInFlight;
}

function invalidateProbeCache() {
  lastProbe = null;
  lastProbeAt = 0;
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

  let launch: { command: string; args: string[]; cwd: string };
  try {
    if (app.isPackaged && !process.env.MEMO_GATEWAY_ROOT) {
      launch = bundledGatewayLaunch(
        process.resourcesPath,
        app.getPath("userData"),
        process.platform,
      );
    } else {
      const root = findMemoRoot();
      launch = { ...gatewayCommand(root), cwd: root };
    }
  } catch (error) {
    status = {
      state: "error",
      running: false,
      latencyMs: null,
      message: error instanceof Error ? error.message : String(error),
    };
    return;
  }

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...resourceEnvironment(),
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: DESKTOP_GATEWAY_PORT,
      MEMO_SANDBOX_ROOT:
        getWorkspacePath() || path.join(app.getPath("userData"), "workspace"),
      ...(app.isPackaged
        ? {
            PYTHONHOME: "",
            PYTHONPATH: "",
            LD_LIBRARY_PATH: path.join(
              process.resourcesPath,
              "gateway",
              "runtime",
              "lib",
            ),
            DYLD_FALLBACK_LIBRARY_PATH: path.join(
              process.resourcesPath,
              "gateway",
              "runtime",
              "lib",
            ),
            MEMO_WHISPER_DEVICE: "cpu",
            MEMO_POCKETTTS_DEVICE: "cpu",
          }
        : {}),
      MEMO_COMPUTER_ENABLED: "1",
      ...(process.platform === "win32"
        ? {
            MEMO_WINDOWS_PROCESS_SANDBOX: "required",
            MEMO_WINDOWS_SANDBOX_RUNNER: app.isPackaged
              ? path.join(process.resourcesPath, "MemoSandbox.exe")
              : path.join(findMemoRoot(), ".sandbox-build", "MemoSandbox.exe"),
          }
        : {}),
      // Loading both local speech models can monopolize startup long enough
      // for the desktop health check to treat the gateway as unavailable.
      // The speech endpoints already initialize their models on first use.
      MEMO_SPEECH_PRELOAD: process.env.MEMO_SPEECH_PRELOAD ?? "0",
      MEMO_STT_PRELOAD: process.env.MEMO_STT_PRELOAD ?? "0",
      MEMO_AGENT_STORE: path.join(app.getPath("userData"), "agents.json"),
      COMPOSIO_API_KEY: getComposioKey() || process.env.COMPOSIO_API_KEY,
      MEMO_COMPOSIO_USER_ID: getComposioUserId(),
      MEMO_CUA_ENDPOINT: getComputerSettings("local_vm").endpoint,
      MEMO_CUA_TOKEN: getComputerSettings("local_vm").token,
      MEMO_VPS_CUA_ENDPOINT: getComputerSettings("vps").endpoint,
      MEMO_VPS_CUA_TOKEN: getComputerSettings("vps").token,
    },
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  managedGateway = child;
  lastGatewayError = "";
  child.stderr?.on("data", rememberGatewayError);

  child.once("error", (error) => {
    invalidateProbeCache();
    if (managedGateway === child) managedGateway = null;
    status = {
      state: "error",
      running: false,
      latencyMs: null,
      message: `Gateway failed to start: ${error.message}`,
    };
  });
  child.once("exit", (code, signal) => {
    invalidateProbeCache();
    if (managedGateway === child) managedGateway = null;
    if (quitting) return;
    void probeGateway(2_000)
      .then((replacement) => {
        if (replacement.running) {
          status = replacement;
          return;
        }
        const detail = lastGatewayError
          ? ` ${lastGatewayError.split(/\r?\n/).at(-1)}`
          : "";
        status = {
          state: code === 0 ? "offline" : "error",
          running: false,
          latencyMs: null,
          message:
            code === 0
              ? "Gateway stopped."
              : `Gateway exited (${signal ?? code ?? "unknown"}).${detail}`,
        };
      })
      .catch(() => {
        status = {
          state: "error",
          running: false,
          latencyMs: null,
          message: `Gateway exited (${signal ?? code ?? "unknown"}).`,
        };
      });
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
      message: "Gateway did not become ready within 90 seconds.",
    };
  }
}

export async function ensureGatewayRunning() {
  // A model load can temporarily prevent the Python event loop from serving
  // health checks. Do not spawn a competing gateway while our child is alive
  // and has already reached the online state.
  if (managedGatewayIsAlive() && status.state === "online") {
    return;
  }

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
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await probeGateway(2_000);
    if (current.running) {
      status = current;
      return;
    }
    await wait(250);
  }
  throw new Error(status.message ?? "Memo gateway is not available.");
}

export function registerGatewayLifecycle() {
  ipcMain.handle("gateway:restart", () => restartManagedGateway());
  ipcMain.handle("gateway:status", async () => {
    const current = await probeGateway();
    if (current.running) {
      status = current;
    } else if (managedGatewayIsAlive() && status.state === "online") {
      status = {
        state: "online",
        running: true,
        latencyMs: null,
        message: "Gateway is busy loading or running a local model.",
      };
      return status;
    } else if (status.state === "online") {
      status = current;
    }

    if (
      !current.running &&
      status.state !== "connecting" &&
      Date.now() - lastStartAttempt >= RESTART_BACKOFF_MS
    ) {
      void ensureGatewayRunning().catch((error: unknown) => {
        status = {
          state: "error",
          running: false,
          latencyMs: null,
          message: error instanceof Error ? error.message : String(error),
        };
      });
      status = { state: "connecting", running: false, latencyMs: null };
    }

    return status;
  });
}

export function stopManagedGateway() {
  quitting = true;
  invalidateProbeCache();
  managedGateway?.kill();
  managedGateway = null;
}

export async function restartManagedGateway() {
  quitting = false;
  invalidateProbeCache();
  const child = managedGateway;
  if (child) {
    child.kill();
    managedGateway = null;
    await wait(300);
  }
  status = { state: "offline", running: false, latencyMs: null };
  lastStartAttempt = 0;
  await ensureGatewayRunning();
}
