import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { MakerDMG } from "@electron-forge/maker-dmg";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "Memo",
    extraResource: [path.resolve(__dirname, "../../.gateway-build/gateway")],
  },
  hooks: {
    prePackage: async () => {
      if (!existsSync(path.resolve(__dirname, "../../.gateway-build/gateway/manifest.json"))) {
        throw new Error("Build the bundled gateway first: python scripts/build_gateway.py");
      }
    },
    postPackage: async (_config, { outputPaths, platform }) => {
      if (platform !== "darwin") return;
      for (const output of outputPaths) {
        const bundle = path.join(output, "Memo.app");
        // Clearing extended attributes is cleanup, not code signing.
        execFileSync("xattr", ["-cr", bundle]);
        execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "inherit" });
        execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "inherit" });
      }
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: "Memo" }),
    new MakerZIP({}, ["darwin", "linux"]),
    new MakerDMG({ format: "ULFO" }),
    new MakerRpm({ options: { name: "memo", bin: "Memo" } }),
    new MakerDeb({ options: { name: "memo", bin: "Memo" } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.config.mts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
