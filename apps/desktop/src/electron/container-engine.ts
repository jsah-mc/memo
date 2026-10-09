import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ContainerEngine = "podman" | "docker";

async function isInstalled(command: ContainerEngine) {
  try {
    await execFileAsync(command, ["--version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function selectContainerEngine(
  available: (engine: ContainerEngine) => Promise<boolean>,
): Promise<ContainerEngine> {
  if (await available("podman")) return "podman";
  if (await available("docker")) return "docker";
  throw new Error(
    "Install Podman or Docker to start the local virtual desktop.",
  );
}

export function detectContainerEngine(): Promise<ContainerEngine> {
  return selectContainerEngine(isInstalled);
}

export async function runCompose(
  args: string[],
  options: Readonly<{ composeFile: string; token: string }>,
) {
  const engine = await detectContainerEngine();
  const result = await execFileAsync(
    engine,
    ["compose", "-f", options.composeFile, ...args],
    {
      cwd: path.dirname(options.composeFile),
      env: { ...process.env, CUA_ENV_TOKEN: options.token },
      windowsHide: true,
      timeout: 180_000,
    },
  );
  return { engine, result };
}
