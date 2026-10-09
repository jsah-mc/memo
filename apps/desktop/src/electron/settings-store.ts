import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type DesktopSettings = {
  composioKey?: string;
  composioUserId?: string;
  cuaEndpoint?: string;
  cuaToken?: string;
};

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

export function getComputerSettings() {
  const settings = readSettings();
  return {
    endpoint: settings.cuaEndpoint ?? "http://127.0.0.1:3211",
    token: decrypt(settings.cuaToken),
  } as const;
}

export function setComputerSettings(input: {
  endpoint: string;
  token?: string;
}) {
  const settings = readSettings();
  settings.cuaEndpoint = input.endpoint;
  if (input.token) settings.cuaToken = encrypt(input.token);
  writeSettings(settings);
}
