import { app, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ensureGatewayRunning,
  GATEWAY_BASE_URL,
  restartManagedGateway,
} from "./gateway-process";
import { getComputerSettings, setComputerSettings } from "./settings-store";
import { detectContainerEngine, runCompose } from "./container-engine";

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
    parsed.port === "3211"
  ) {
    parsed.port = "3212";
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
  ipcMain.handle("virtual-desktop:get", async () => {
    const current = getComputerSettings();
    const containerEngine = await detectContainerEngine().catch(
      (): null => null,
    );
    return {
      endpoint: current.endpoint,
      hasToken: Boolean(current.token),
      containerEngine,
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
    async (_event, input: { endpoint: string; token?: string }) => {
      const endpoint = normalizeEndpoint(input.endpoint);
      if (!input.token && !getComputerSettings().token) {
        throw new Error("Enter the CUA access token.");
      }
      setComputerSettings({ ...input, endpoint });
      await restartManagedGateway();
      return { saved: true };
    },
  );
  ipcMain.handle("virtual-desktop:start", async () => {
    const current = getComputerSettings();
    const token = current.token || randomBytes(24).toString("hex");
    setComputerSettings({
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
      getComputerSettings().token || randomBytes(24).toString("hex");
    const { engine: containerEngine } = await containerCompose(["down"], token);
    return { stopped: true, containerEngine };
  });
  ipcMain.handle("virtual-desktop:open", async () => {
    const { endpoint } = getComputerSettings();
    await shell.openExternal(viewerUrl(endpoint));
    return { opened: true };
  });
  ipcMain.handle("virtual-desktop:preview", async () => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/desktop/preview`, {
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
