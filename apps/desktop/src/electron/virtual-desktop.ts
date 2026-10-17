import { app, ipcMain, shell } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  ensureGatewayRunning,
  GATEWAY_BASE_URL,
  restartManagedGateway,
} from "./gateway-process";
import {
  getComputerSettings,
  getVpsSshSettings,
  setComputerSettings,
  setVpsSshSettings,
} from "./settings-store";
import { detectContainerEngine, runCompose } from "./container-engine";

const execFileAsync = promisify(execFile);
let vpsTunnel: ChildProcess | null = null;

function projectRoot() {
  const candidates = [
    process.env.MEMO_GATEWAY_ROOT,
    process.cwd(),
    app.getAppPath(),
  ].filter((value): value is string => Boolean(value));
  for (const start of candidates) {
    let current = path.resolve(start);
    while (path.dirname(current) !== current) {
      const compose = path.join(
        current,
        "deploy",
        "cua-desktop",
        "compose.yaml",
      );
      if (existsSync(compose)) return current;
      current = path.dirname(current);
    }
  }
  return null;
}

function composeFile() {
  const packaged = path.join(
    process.resourcesPath,
    "cua-desktop",
    "compose.yaml",
  );
  if (app.isPackaged && existsSync(packaged)) return packaged;
  const root = projectRoot();
  if (!root) throw new Error("The bundled virtual desktop setup is missing.");
  return path.join(root, "deploy", "cua-desktop", "compose.yaml");
}

function desktopBundleDirectory() {
  return path.dirname(composeFile());
}

function sshArgs(input: { host: string; user: string; port: number; identityFile?: string }) {
  if (!/^[a-zA-Z0-9._:-]+$/.test(input.host) || !/^[a-zA-Z0-9._-]+$/.test(input.user)) {
    throw new Error("Enter a valid SSH host and user.");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("SSH port must be between 1 and 65535.");
  }
  return [
    "-p",
    String(input.port),
    ...(input.identityFile ? ["-i", input.identityFile] : []),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
  ];
}

async function provisionVps(input: { host: string; user: string; port: number; identityFile?: string }) {
  const common = sshArgs(input);
  const destination = `${input.user}@${input.host}`;
  await execFileAsync("ssh", [...common, destination, "mkdir -p ~/.memo"], {
    windowsHide: true,
    timeout: 30_000,
  });
  const scpArgs = [
    "-P",
    String(input.port),
    ...(input.identityFile ? ["-i", input.identityFile] : []),
    "-r",
    desktopBundleDirectory(),
    `${destination}:~/.memo/`,
  ];
  await execFileAsync("scp", scpArgs, { windowsHide: true, timeout: 120_000 });
  const token = randomBytes(24).toString("hex");
  const remote = `set -e; if ! command -v podman >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then sudo -n apt-get update && sudo -n apt-get install -y docker.io docker-compose-v2; elif command -v dnf >/dev/null 2>&1; then sudo -n dnf install -y docker docker-compose-plugin && sudo -n systemctl enable --now docker; else echo 'Install Docker or Podman on this VPS.' >&2; exit 69; fi; fi; cd ~/.memo/cua-desktop && printf 'CUA_ENV_TOKEN=${token}\\n' > .env && if command -v podman >/dev/null 2>&1; then podman compose up -d --build; elif docker info >/dev/null 2>&1; then docker compose up -d --build; else sudo -n docker compose up -d --build; fi`;
  await execFileAsync("ssh", [...common, destination, remote], {
    windowsHide: true,
    timeout: 300_000,
  });
  startVpsTunnel(input, true);
  setVpsSshSettings(input);
  setComputerSettings({ target: "vps", endpoint: "http://127.0.0.1:3213", token });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await restartManagedGateway();
  return probe("http://127.0.0.1:3213", token);
}

function startVpsTunnel(
  input: { host: string; user: string; port: number; identityFile?: string },
  replace = false,
) {
  if (vpsTunnel && !replace) return;
  if (replace) vpsTunnel?.kill();
  const common = sshArgs(input);
  vpsTunnel = spawn(
    "ssh",
    [
      ...common,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-N",
      "-L",
      "3213:127.0.0.1:3211",
      "-L",
      "3214:127.0.0.1:3212",
      `${input.user}@${input.host}`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  vpsTunnel.once("exit", () => {
    vpsTunnel = null;
  });
}

function normalizeEndpoint(value: string) {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Use an http:// or https:// CUA endpoint.");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function viewerUrl(endpoint: string) {
  const parsed = new URL(normalizeEndpoint(endpoint));
  if (
    ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
    ["3211", "3213"].includes(parsed.port)
  ) {
    parsed.port = parsed.port === "3213" ? "3214" : "3212";
    parsed.pathname = "/vnc.html";
    return parsed.toString();
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/viewer/`;
  return parsed.toString();
}

async function containerCompose(args: string[], token: string) {
  const file = composeFile();
  return runCompose(args, { composeFile: file, token });
}

async function probe(endpoint: string, token: string) {
  const started = performance.now();
  try {
    const response = await fetch(`${endpoint}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
    return {
      reachable: response.status < 500,
      latencyMs: Math.round(performance.now() - started),
      message:
        response.status < 500
          ? "Virtual desktop is ready."
          : `Service returned ${response.status}.`,
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: null,
      message:
        error instanceof Error
          ? error.message
          : "Could not reach the virtual desktop.",
    };
  }
}

export function registerVirtualDesktop() {
  ipcMain.handle("virtual-desktop:get", async (_event, target: "local_vm" | "vps" = "local_vm") => {
    const current = getComputerSettings(target);
    if (target === "vps" && current.token) {
      const ssh = getVpsSshSettings();
      if (ssh.host && ssh.user) startVpsTunnel(ssh);
    }
    const containerEngine = await detectContainerEngine().catch(
      (): null => null,
    );
    return {
      endpoint: current.endpoint,
      hasToken: Boolean(current.token),
      containerEngine,
      ...(target === "vps" ? getVpsSshSettings() : {}),
      ...(current.token
        ? await probe(current.endpoint, current.token)
        : {
            reachable: false,
            latencyMs: null,
            message: "Not connected.",
          }),
    };
  });
  ipcMain.handle(
    "virtual-desktop:save",
    async (_event, input: { target?: "local_vm" | "vps"; endpoint: string; token?: string }) => {
      const endpoint = normalizeEndpoint(input.endpoint);
      const target = input.target ?? "local_vm";
      if (!input.token && !getComputerSettings(target).token) {
        throw new Error("Enter the CUA access token.");
      }
      setComputerSettings({ ...input, target, endpoint });
      await restartManagedGateway();
      return { saved: true };
    },
  );
  ipcMain.handle("virtual-desktop:vps-setup", async (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Enter VPS SSH settings.");
    const value = input as Record<string, unknown>;
    return provisionVps({
      host: String(value.host ?? "").trim(),
      user: String(value.user ?? "").trim(),
      port: Number(value.port ?? 22),
      identityFile: String(value.identityFile ?? "").trim() || undefined,
    });
  });
  ipcMain.handle("virtual-desktop:start", async () => {
    const current = getComputerSettings("local_vm");
    const token = current.token || randomBytes(24).toString("hex");
    setComputerSettings({
      target: "local_vm",
      endpoint: "http://127.0.0.1:3211",
      token,
    });
    const { engine: containerEngine } = await containerCompose(
      ["up", "-d", "--build"],
      token,
    );
    await restartManagedGateway();
    return {
      ...(await probe("http://127.0.0.1:3211", token)),
      containerEngine,
    };
  });
  ipcMain.handle("virtual-desktop:stop", async () => {
    const token =
      getComputerSettings("local_vm").token || randomBytes(24).toString("hex");
    const { engine: containerEngine } = await containerCompose(["down"], token);
    return { stopped: true, containerEngine };
  });
  ipcMain.handle("virtual-desktop:open", async (_event, target: "local_vm" | "vps" = "local_vm") => {
    const { endpoint } = getComputerSettings(target);
    await shell.openExternal(viewerUrl(endpoint));
    return { opened: true };
  });
  ipcMain.handle("virtual-desktop:preview", async (_event, target: "local_vm" | "vps" = "local_vm") => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/desktop/preview?target=${target}`, {
      headers: { "X-Memo-Desktop": "1" },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json()) as {
      image?: unknown;
      detail?: unknown;
    };
    if (!response.ok || typeof payload.image !== "string") {
      throw new Error(
        typeof payload.detail === "string"
          ? payload.detail
          : "Could not preview the shared VM.",
      );
    }
    return { image: payload.image };
  });
}
