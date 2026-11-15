import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGateway, GATEWAY_URL } from "./gateway";
import { loadSettings } from "./settings";

const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;

let managedGateway: ChildProcess | null = null;
let startup: Promise<{ ok: boolean; message?: string }> | null = null;
let lastGatewayError = "";

function isMemoRoot(candidate: string): boolean {
  const projectFile = join(candidate, "pyproject.toml");
  if (!existsSync(projectFile)) return false;
  try {
    return /\bname\s*=\s*["']memo["']/.test(readFileSync(projectFile, "utf8"));
  } catch {
    return false;
  }
}

function walkToMemoRoot(start: string): string | null {
  let candidate = resolve(start);
  let parent = dirname(candidate);
  while (parent !== candidate) {
    if (isMemoRoot(candidate)) return candidate;
    candidate = parent;
    parent = dirname(candidate);
  }
  return isMemoRoot(candidate) ? candidate : null;
}

function findMemoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MEMO_GATEWAY_ROOT,
    process.cwd(),
    // apps/tui/src -> repo root
    resolve(here, "../../.."),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const root = walkToMemoRoot(candidate);
    if (root) return root;
  }
  throw new Error(
    "Could not locate the Memo gateway. Set MEMO_GATEWAY_ROOT to the repository path.",
  );
}

function gatewayCommand(root: string): { command: string; args: string[] } {
  const configuredPython = process.env.MEMO_GATEWAY_PYTHON;
  const pythonCandidates = [
    configuredPython,
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const python = pythonCandidates.find(existsSync);
  if (python) {
    return { command: python, args: [join(root, "main.py"), "gateway"] };
  }

  return {
    command: process.platform === "win32" ? "uv.exe" : "uv",
    args: ["run", "memo", "gateway"],
  };
}

function gatewayPort(): string {
  try {
    return new URL(GATEWAY_URL).port || "80";
  } catch {
    return "4010";
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startGateway(): Promise<{ ok: boolean; message?: string }> {
  if (await checkGateway()) return { ok: true };

  let launch: { command: string; args: string[]; cwd: string };
  try {
    const root = findMemoRoot();
    launch = { ...gatewayCommand(root), cwd: root };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  lastGatewayError = "";
  const settings = loadSettings();
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: gatewayPort(),
      // Speech models load lazily; preloading stalls gateway startup.
      MEMO_SPEECH_PRELOAD: process.env.MEMO_SPEECH_PRELOAD ?? "0",
      MEMO_STT_PRELOAD: process.env.MEMO_STT_PRELOAD ?? "0",
      MEMO_AGENT_STORE: join(homedir(), ".memo", "agents.json"),
      MEMO_COMPOSIO_USER_ID:
        settings.composioUserId.trim() ||
        process.env.MEMO_COMPOSIO_USER_ID ||
        "memo",
      ...(settings.composioKey.trim()
        ? { COMPOSIO_API_KEY: settings.composioKey.trim() }
        : {}),
    },
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  managedGateway = child;
  child.stderr?.on("data", (chunk: Buffer | string) => {
    lastGatewayError = `${lastGatewayError}${String(chunk)}`.slice(-4_000);
  });

  // Only kill the gateway if this process spawned it.
  process.once("exit", () => {
    if (managedGateway === child) child.kill();
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      managedGateway = null;
      const detail = lastGatewayError.trim().split(/\r?\n/).at(-1);
      return {
        ok: false,
        message: `Gateway exited (${child.exitCode}).${detail ? ` ${detail}` : ""}`,
      };
    }
    if (await checkGateway()) {
      return { ok: true };
    }
    await wait(POLL_INTERVAL_MS);
  }

  child.kill();
  managedGateway = null;
  return { ok: false, message: "Gateway did not become ready within 90 seconds." };
}

/**
 * Ensure a gateway is reachable, spawning one from the repo if needed.
 * Safe to call repeatedly — concurrent calls share one startup.
 */
export function ensureGateway(): Promise<{ ok: boolean; message?: string }> {
  if (!startup) {
    startup = startGateway().finally(() => {
      startup = null;
    });
  }
  return startup;
}
