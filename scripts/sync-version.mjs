import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error("Usage: pnpm version:sync <semver>");
}

for (const file of ["package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"]) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const pyproject = readFileSync("pyproject.toml", "utf8").replace(
  /^version = "[^"]+"/m,
  `version = "${version}"`,
);
writeFileSync("pyproject.toml", pyproject);

const desktopCargoPath = "apps/desktop/src-tauri/Cargo.toml";
writeFileSync(desktopCargoPath, readFileSync(desktopCargoPath, "utf8").replace(
  /^version = "[^"]+"/m,
  `version = "${version}"`,
));

for (const [file, name] of [["uv.lock", "memo"], ["apps/desktop/src-tauri/Cargo.lock", "memo-desktop"]]) {
  const contents = readFileSync(file, "utf8");
  const pattern = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]+(")`);
  if (!pattern.test(contents)) throw new Error(`Missing ${name} package in ${file}`);
  writeFileSync(file, contents.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`));
}
console.log(`Memo version synchronized to ${version}.`);
