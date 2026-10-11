export type PermissionMode = "ask" | "auto" | "allow" | "allowlist" | "custom";

let currentMode: PermissionMode = "ask";

export function getPermissionMode(): PermissionMode {
  return currentMode;
}

export async function loadPermissionMode(): Promise<PermissionMode> {
  currentMode = await window.desktopApi.permissionMode.get();
  return currentMode;
}

export async function setPermissionMode(mode: PermissionMode): Promise<void> {
  currentMode = mode;
  await window.desktopApi.permissionMode.set(mode);
}
