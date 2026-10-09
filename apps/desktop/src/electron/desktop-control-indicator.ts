import { BrowserWindow, screen } from "electron";

const overlays: BrowserWindow[] = [];
const activeRequests = new Set<string>();

const indicatorHtml = encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body {
    border: 4px solid #f59e0b;
    box-shadow: inset 0 0 24px rgba(245, 158, 11, .55);
    font-family: system-ui, sans-serif;
  }
  .badge {
    position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
    padding: 6px 12px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px;
    color: #fff7ed; background: rgba(120, 53, 15, .92); box-shadow: 0 4px 18px rgba(0,0,0,.35);
    font-size: 12px; font-weight: 650; letter-spacing: .01em;
  }
</style></head><body><div class="badge">Agent controlling this desktop</div></body></html>`);

function destroyOverlays() {
  for (const overlay of overlays.splice(0)) {
    if (!overlay.isDestroyed()) overlay.destroy();
  }
}

function createOverlays() {
  destroyOverlays();
  for (const display of screen.getAllDisplays()) {
    const overlay = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void overlay.loadURL(`data:text/html;charset=utf-8,${indicatorHtml}`);
    overlay.once("ready-to-show", () => overlay.showInactive());
    overlays.push(overlay);
  }
}

export function startDesktopControlIndicator(requestId: string) {
  activeRequests.add(requestId);
  if (overlays.length === 0) createOverlays();
}

export function stopDesktopControlIndicator(requestId: string) {
  activeRequests.delete(requestId);
  if (activeRequests.size === 0) destroyOverlays();
}

export function stopAllDesktopControlIndicators() {
  activeRequests.clear();
  destroyOverlays();
}
