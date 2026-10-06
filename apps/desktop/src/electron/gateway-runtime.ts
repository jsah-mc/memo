import { existsSync } from "node:fs";
import path from "node:path";

export function bundledGatewayLaunch(resources: string, userData: string, platform: string) {
  const bundle = path.join(resources, "gateway");
  const command = platform === "win32"
    ? path.join(bundle, "runtime", "python.exe")
    : path.join(bundle, "runtime", "bin", "python3");
  const entry = path.join(bundle, "app", "gateway_entry.py");
  if (!existsSync(command) || !existsSync(entry)) {
    throw new Error("The bundled gateway is missing. Reinstall Memo from the latest release.");
  }
  return { command, args: ["-s", "-B", entry], cwd: userData };
}
