import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const packager = readFileSync("scripts/package_release.py", "utf8");

test("desktop and CLI are independent installs", () => {
  assert.equal(config.bundle.externalBin, undefined);
  assert.match(workflow, /Package separate Desktop and CLI installers/);
  assert.match(packager, /desktop_dir = root \/ "desktop"/);
  assert.match(packager, /cli_dir = root \/ "cli"/);
});

test("release requires Windows and updater signatures", () => {
  assert.match(workflow, /WINDOWS_CERTIFICATE/);
  assert.match(workflow, /Import-PfxCertificate/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.endpoints[0], /latest\.json$/);
});

test("release publishes one platform zip plus an update manifest", () => {
  assert.match(workflow, /release-package\/\*\.zip/);
  assert.match(workflow, /latest\.json/);
  assert.match(workflow, /SHA256SUMS\.txt/);
});
