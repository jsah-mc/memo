import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopApi", {
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  streamChat: (
    request: {
      id: string;
      agent: {
        cli: string;
        model: string;
        composioEnabled: boolean;
        composioUserId: string;
        composioToolkits: readonly string[];
      };
      messages: Array<{
        role: "system" | "user" | "assistant";
        content:
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
              | {
                  type: "file";
                  file: { filename: string; file_data: string };
                }
            >;
      }>;
    },
    onEvent: (event: unknown) => void,
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, event: unknown) => {
      if (
        event &&
        typeof event === "object" &&
        "id" in event &&
        event.id === request.id
      ) {
        onEvent(event);
      }
    };
    ipcRenderer.on("chat:event", listener);
    ipcRenderer.send("chat:stream", request);
    return () => ipcRenderer.removeListener("chat:event", listener);
  },
  cancelChat: (requestId: string) => ipcRenderer.send("chat:cancel", requestId),
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    backends: () => ipcRenderer.invoke("agents:backends"),
    create: (agent: unknown) => ipcRenderer.invoke("agents:create", agent),
    delete: (agentId: string) => ipcRenderer.invoke("agents:delete", agentId),
    update: (
      agentId: string,
      changes: {
        computerTarget?: "host" | "virtual";
        cli?: string;
        model?: string;
      },
    ) => ipcRenderer.invoke("agents:update", agentId, changes),
  },
  onPermissionRequest: (onRequest: (request: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) =>
      onRequest(request);
    ipcRenderer.on("permission:request", listener);
    return () => ipcRenderer.removeListener("permission:request", listener);
  },
  respondPermission: (response: { id: string; allowed: boolean }) =>
    ipcRenderer.send("permission:respond", response),
  getGatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  getSystemHealth: () => ipcRenderer.invoke("system:health"),
  openCodexHelp: () => ipcRenderer.invoke("auth:open-codex-help"),
  restartGateway: () => ipcRenderer.invoke("gateway:restart"),
  virtualDesktop: {
    get: () => ipcRenderer.invoke("virtual-desktop:get"),
    save: (settings: { endpoint: string; token?: string }) =>
      ipcRenderer.invoke("virtual-desktop:save", settings),
    start: () => ipcRenderer.invoke("virtual-desktop:start"),
    stop: () => ipcRenderer.invoke("virtual-desktop:stop"),
    open: () => ipcRenderer.invoke("virtual-desktop:open"),
    preview: () => ipcRenderer.invoke("virtual-desktop:preview"),
  },
  getComposioStatus: () => ipcRenderer.invoke("composio:status"),
  getComposioToolkits: (search = "") =>
    ipcRenderer.invoke("composio:toolkits", search),
  getComposioConnections: () => ipcRenderer.invoke("composio:connections"),
  disconnectComposio: (connectionId: string) =>
    ipcRenderer.invoke("composio:disconnect", connectionId),
  getComposioKeyStatus: () => ipcRenderer.invoke("composio:key-status"),
  setComposioKey: (key: string) => ipcRenderer.invoke("composio:set-key", key),
  authorizeComposio: (toolkit: string) =>
    ipcRenderer.invoke("composio:authorize", toolkit),
  traceSpeech: (stage: string) => ipcRenderer.send("speech:trace", stage),
  prepareSpeech: () => ipcRenderer.invoke("speech:prepare"),
  transcribeSpeech: (request: {
    audio: string;
    mimeType: string;
    filename: string;
  }) => ipcRenderer.invoke("speech:transcribe", request),
  streamSpeech: (
    request: { id: string; text: string },
    onEvent: (event: unknown) => void,
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, event: unknown) => {
      if (
        event &&
        typeof event === "object" &&
        "id" in event &&
        event.id === request.id
      ) {
        onEvent(event);
      }
    };
    ipcRenderer.on("speech:event", listener);
    ipcRenderer.send("speech:stream", request);
    return () => ipcRenderer.removeListener("speech:event", listener);
  },
  cancelSpeech: (requestId: string) =>
    ipcRenderer.send("speech:cancel", requestId),
  chatHistory: {
    getItem: (key: string) => ipcRenderer.invoke("chat-history:get", key),
    setItem: (key: string, value: string) =>
      ipcRenderer.invoke("chat-history:set", key, value),
    removeItem: (key: string) => ipcRenderer.invoke("chat-history:remove", key),
  },
});
