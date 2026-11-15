import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TuiSettings = {
  systemPromptPath: string;
  voiceModel: string;
  sttModel: string;
  ttsModel: string;
  speechVoice: string;
  composioUserId: string;
  composioKey: string;
};

export const SETTINGS_FIELDS: Array<{
  key: keyof TuiSettings;
  label: string;
}> = [
  { key: "systemPromptPath", label: "system prompt path" },
  { key: "voiceModel", label: "voice model" },
  { key: "sttModel", label: "stt model" },
  { key: "ttsModel", label: "tts model" },
  { key: "speechVoice", label: "speech voice" },
  { key: "composioUserId", label: "composio user id" },
  { key: "composioKey", label: "composio api key" },
];

export const DEFAULT_SETTINGS: TuiSettings = {
  systemPromptPath: "",
  voiceModel: "",
  sttModel: "",
  ttsModel: "",
  speechVoice: "",
  composioUserId: "",
  composioKey: "",
};

export function settingsPath(): string {
  return join(homedir(), ".memo", "settings.json");
}

export function loadSettings(): TuiSettings {
  try {
    if (!existsSync(settingsPath())) return { ...DEFAULT_SETTINGS };
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<
      string,
      unknown
    >;
    const settings = { ...DEFAULT_SETTINGS };
    for (const { key } of SETTINGS_FIELDS) {
      const value = raw[key];
      if (typeof value === "string") settings[key] = value;
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: TuiSettings): void {
  try {
    const file = settingsPath();
    mkdirSync(join(homedir(), ".memo"), { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // Settings persistence is best-effort.
  }
}
