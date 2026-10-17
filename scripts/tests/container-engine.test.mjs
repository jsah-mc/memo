import assert from "node:assert/strict";
import test from "node:test";
import { selectContainerEngine } from "../../apps/desktop/src/electron/container-engine.ts";

test("Podman is preferred when both engines are installed", async () => {
  const checked = [];
  const engine = await selectContainerEngine(async (candidate) => {
    checked.push(candidate);
    return true;
  });
  assert.equal(engine, "podman");
  assert.deepEqual(checked, ["podman"]);
});

test("Docker is used when Podman is unavailable", async () => {
  const engine = await selectContainerEngine(
    async (candidate) => candidate === "docker",
  );
  assert.equal(engine, "docker");
});

test("a clear error is returned when neither engine is installed", async () => {
  await assert.rejects(
    selectContainerEngine(async () => false),
    /Install Podman or Docker/,
  );
});
