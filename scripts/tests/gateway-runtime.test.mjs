import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { bundledGatewayLaunch } from "../../apps/desktop/src/electron/gateway-runtime.ts";

for (const platform of ["linux", "darwin", "win32"]) {
  test(`bundled ${platform} gateway runs from user data without a checkout`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "memo-runtime-"));
    try {
      const resources = path.join(root, "resources");
      const data = path.join(root, "user-data");
      const python = path.join(resources, "gateway", "runtime", ...(platform === "win32" ? ["python.exe"] : ["bin", "python3"]));
      const entry = path.join(resources, "gateway", "app", "gateway_entry.py");
      for (const file of [python, entry]) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "test");
      }
      assert.deepEqual(bundledGatewayLaunch(resources, data, platform), {
        command: python, args: ["-s", "-B", entry], cwd: data,
      });
      rmSync(entry);
      assert.throws(() => bundledGatewayLaunch(resources, data, platform), /bundled gateway is missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
