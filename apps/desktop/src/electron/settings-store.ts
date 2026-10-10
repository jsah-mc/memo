import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type DesktopSettings = {
  composioKey?: string;
  composioUserId?: string;
  cuaEndpoint?: string;
  cuaToken?: string;
  vpsCuaEndpoint?: string;
  vpsCuaToken?: string;
  vpsSshHost?: string;
  vpsSshUser?: string;
  vpsSshPort?: number;
  vpsSshIdentityFile?: string;
  resourceMode?: ResourceMode;
  workspacePath?: string;
};

export type ResourceMode = "low" | "balanced" | "performance";

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(): DesktopSettings {
  try {
    return existsSync(settingsPath())
      ? JSON.parse(readFileSync(settingsPath(), "utf8"))
      : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: DesktopSettings) {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

export function getComposioKey() {
  const encoded = readSettings().composioKey;
  if (!encoded) return "";
  try {
    const data = Buffer.from(encoded, "base64");
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString("utf8");
  } catch {
    return "";
  }
}

export function setComposioKey(key: string) {
  const settings = readSettings();
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key)
    : Buffer.from(key, "utf8");
  settings.composioKey = data.toString("base64");
  writeSettings(settings);
}

export function getComposioUserId() {
  const settings = readSettings();
  if (settings.composioUserId) return settings.composioUserId;
  settings.composioUserId = `memo_${randomUUID()}`;
  writeSettings(settings);
  return settings.composioUserId;
}

function decrypt(value?: string) {
  if (!value) return "";
  try {
    const data = Buffer.from(value, "base64");
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString("utf8");
  } catch {
    return "";
  }
}

function encrypt(value: string) {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, "utf8");
  return data.toString("base64");
}

export function getComputerSettings(target: "local_vm" | "vps" = "local_vm") {
  const settings = readSettings();
  const isVps = target === "vps";
  return {
    endpoint: isVps
      ? (settings.vpsCuaEndpoint ?? "")
      : (settings.cuaEndpoint ?? "http://127.0.0.1:3211"),
    token: decrypt(isVps ? settings.vpsCuaToken : settings.cuaToken),
  } as const;
}

export function setComputerSettings(input: {
  target?: "local_vm" | "vps";
  endpoint: string;
  token?: string;
}) {
  const settings = readSettings();
  if (input.target === "vps") {
    settings.vpsCuaEndpoint = input.endpoint;
    if (input.token) settings.vpsCuaToken = encrypt(input.token);
  } else {
    settings.cuaEndpoint = input.endpoint;
    if (input.token) settings.cuaToken = encrypt(input.token);
  }
  writeSettings(settings);
}

export function getVpsSshSettings() {
  const settings = readSettings();
  return {
    host: settings.vpsSshHost ?? "",
    user: settings.vpsSshUser ?? "",
    port: settings.vpsSshPort ?? 22,
    identityFile: settings.vpsSshIdentityFile ?? "",
  } as const;
}

export function setVpsSshSettings(input: {
  host: string;
  user: string;
  port: number;
  identityFile?: string;
}) {
  const settings = readSettings();
  settings.vpsSshHost = input.host;
  settings.vpsSshUser = input.user;
  settings.vpsSshPort = input.port;
  settings.vpsSshIdentityFile = input.identityFile ?? "";
  writeSettings(settings);
}

export function getResourceMode(): ResourceMode {
  const value = readSettings().resourceMode;
  return value === "low" || value === "performance" ? value : "balanced";
}

export function setResourceMode(mode: ResourceMode) {
  const settings = readSettings();
  settings.resourceMode = mode;
  writeSettings(settings);
}

export function getWorkspacePath() {
  return readSettings().workspacePath ?? "";
}

export function setWorkspacePath(workspacePath: string) {
  const settings = readSettings();
  settings.workspacePath = workspacePath;
  writeSettings(settings);
}
