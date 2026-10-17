import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(
  new URL("../../apps/desktop/src/electron/gateway-process.ts", import.meta.url),
  "utf8",
);
const titlebar = readFileSync(
  new URL("../../apps/desktop/src/components/titlebar.tsx", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../apps/desktop/src/electron/workspace.ts", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../../apps/desktop/src/runtime-provider.tsx", import.meta.url),
  "utf8",
);

test("gateway health probes are cached and concurrent probes are shared", () => {
  assert.match(gateway, /ONLINE_PROBE_CACHE_MS = 5_000/);
  assert.match(gateway, /if \(probeInFlight\) return probeInFlight/);
  assert.match(gateway, /lastProbeAt = Date\.now\(\)/);
});

test("background windows do not continuously poll gateway health", () => {
  assert.match(titlebar, /document\.visibilityState === "visible"/);
  assert.match(titlebar, /setInterval\(refreshWhenVisible, 30_000\)/);
  assert.match(titlebar, /removeEventListener\("visibilitychange"/);
});

test("resource modes impose real compute and idle-model limits", () => {
  assert.match(gateway, /MEMO_SPEECH_CPU_THREADS: threads/);
  assert.match(gateway, /OMP_NUM_THREADS: threads/);
  assert.match(gateway, /MEMO_SPEECH_IDLE_TIMEOUT_SECONDS/);
});

test("project checkpoints preserve patches and untracked files", () => {
  assert.match(workspace, /git", \["diff", "--binary", "HEAD"\]/);
  assert.match(workspace, /"untracked", relative/);
  assert.match(workspace, /checkpoint\.json/);
});

test("task activity follows live chat and tool lifecycle", () => {
  assert.match(runtime, /activity\.start/);
  assert.match(runtime, /activity\.tool/);
  assert.match(runtime, /activity\.finish/);
});
