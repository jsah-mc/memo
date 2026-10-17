import { MakerDMG } from "@electron-forge/maker-dmg";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import path from "node:path";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.jsah.memo",
    appCategoryType: "public.app-category.developer-tools",
    executableName: "Memo",
    icon: path.resolve(__dirname, "assets", "memo-icon"),
    extraResource: [path.resolve(__dirname, "assets")],
    extendInfo: {
      NSMicrophoneUsageDescription: "Memo uses the microphone for voice conversations.",
      NSSpeechRecognitionUsageDescription: "Memo uses speech recognition for voice conversations.",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: "Memo" }),
    new MakerZIP({}, ["darwin", "linux"]),
    new MakerDMG({ format: "ULFO", icon: path.resolve(__dirname, "assets", "memo-icon.icns") }),
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
