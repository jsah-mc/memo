import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = process.platform === "win32" ? ".exe" : "";
const source = join(root, "target", "release", `memo${extension}`);
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).trim();

if (!targetTriple) {
  throw new Error("rustc did not report a host target triple");
}
if (!existsSync(source)) {
  throw new Error(`Build the native CLI first; missing ${source}`);
}

const binaries = join(root, "apps", "desktop", "src-tauri", "binaries");
const destination = join(binaries, `memo-${targetTriple}${extension}`);
mkdirSync(binaries, { recursive: true });
copyFileSync(source, destination);
if (process.platform !== "win32") {
  chmodSync(destination, 0o755);
}

console.log(`Prepared Memo CLI sidecar: ${destination}`);
