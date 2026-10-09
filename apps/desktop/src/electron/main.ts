import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { registerChatApi } from "./chat-api";
import { closeChatHistory, registerChatHistory } from "./chat-history";
import {
  ensureGatewayRunning,
  registerGatewayLifecycle,
  stopManagedGateway,
} from "./gateway-process";
import { registerVirtualDesktop } from "./virtual-desktop";
import { stopAllDesktopControlIndicators } from "./desktop-control-indicator";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

registerChatApi();
registerChatHistory();
registerGatewayLifecycle();
registerVirtualDesktop();

ipcMain.on("window:minimize", (event) =>
  BrowserWindow.fromWebContents(event.sender)?.minimize(),
);
ipcMain.on("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("window:close", (event) =>
  BrowserWindow.fromWebContents(event.sender)?.close(),
);

const createWindow = () => {
  // Create the browser window.
  const win = new BrowserWindow({
    show: false,
    backgroundColor: "#101014",
    width: 1400,
    height: 800,
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : url.startsWith("file:");
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const showMainWindow = () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

app.on("second-instance", showMainWindow);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  if (!hasSingleInstanceLock) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptPolicy = app.isPackaged
      ? "script-src 'self'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const connectPolicy = app.isPackaged
      ? "connect-src 'self' http://127.0.0.1:*"
      : "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://localhost:*";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; ${connectPolicy}; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`,
        ],
      },
    });
  });
  void ensureGatewayRunning().catch((error: unknown) => {
    console.error("Memo gateway startup failed:", error);
  });
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopAllDesktopControlIndicators();
  stopManagedGateway();
  closeChatHistory();
});

app.on("activate", () => {
  showMainWindow();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
