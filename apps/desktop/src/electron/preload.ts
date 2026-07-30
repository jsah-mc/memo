import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopApi", {
  streamChat: (
    request: {
      id: string;
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
  onPermissionRequest: (onRequest: (request: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) =>
      onRequest(request);
    ipcRenderer.on("permission:request", listener);
    return () => ipcRenderer.removeListener("permission:request", listener);
  },
  respondPermission: (response: { id: string; allowed: boolean }) =>
    ipcRenderer.send("permission:respond", response),
  getGatewayStatus: () => ipcRenderer.invoke("gateway:status"),
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

contextBridge.exposeInMainWorld("windowButtons", {
  close: () => ipcRenderer.send("window:close"),
  maximize: () => ipcRenderer.send("window:maximize"),
  minimize: () => ipcRenderer.send("window:minimize"),
  setTitlebarTheme: (isDark: boolean) =>
    ipcRenderer.send("titlebar:set-theme", isDark),
});
