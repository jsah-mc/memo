import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const workflow = readFileSync(".github/workflows/release.yml", "utf8");

test("desktop installers bundle the native CLI", () => {
  assert.deepEqual(config.bundle.externalBin, ["binaries/memo"]);

  const buildCli = workflow.indexOf("- name: Build native CLI");
  const prepareSidecar = workflow.indexOf(
    "- name: Prepare CLI sidecar for desktop installer",
  );
  const buildDesktop = workflow.indexOf(
    "- name: Build desktop installers and signed updater",
  );

  assert.ok(buildCli >= 0);
  assert.ok(prepareSidecar > buildCli);
  assert.ok(buildDesktop > prepareSidecar);
  assert.match(workflow, /"memo-\{host\}\{suffix\}"/);
});

test("release requires updater signatures with opt-in Windows signing", () => {
  for (const step of ["Import Windows signing certificate", "Configure Windows Authenticode"]) {
    const block = workflow.split(`- name: ${step}`)[1]?.split("- name:")[0];
    assert.ok(block, step);
    assert.match(block, /if: runner\.os == 'Windows' && vars\.WINDOWS_AUTHENTICODE_ENABLED == 'true'/);
  }
  assert.match(workflow, /required = \["TAURI_SIGNING_PRIVATE_KEY", "TAURI_UPDATER_PUBLIC_KEY"\]/);
  assert.match(workflow, /WINDOWS_CERTIFICATE/);
  assert.match(workflow, /Import-PfxCertificate/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.endpoints[0], /latest\.json$/);
});

test("release publishes platform installers plus an update manifest", () => {
  assert.match(
    workflow,
    /apps\/desktop\/src-tauri\/target\/release\/bundle\/\*\*\/\*/,
  );
  assert.match(workflow, /files: release-assets\/\*/);
  assert.match(workflow, /latest\.json/);
  assert.match(workflow, /SHA256SUMS\.txt/);
});
