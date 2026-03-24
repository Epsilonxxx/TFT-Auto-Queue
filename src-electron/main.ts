import path from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage } from "electron";
import { AutoQueueService } from "./services/autoQueueService";
import { log } from "./utils/logger";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const service = new AutoQueueService();
let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let stateBroadcastTimer: NodeJS.Timeout | null = null;
let quitting = false;

function icon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath, "assets", "tray.png"),
    path.join(__dirname, "..", "assets", "tray.png")
  ];

  for (const p of candidates) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      return img;
    }
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPUlEQVR4Ae3WQQEAAAgDIN8/9K3hHFQgYJpQJ8wYDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBwN9YhAT8gD8X8AAAAAElFTkSuQmCC"
  );
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1040,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    autoHideMenuBar: true,
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const indexPath = path.join(__dirname, "..", "dist-renderer", "index.html");
  void win.loadFile(indexPath);
  win.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    win?.hide();
  });
}

function updateTray(): void {
  if (!tray) {
    return;
  }
  const snap = service.getSnapshot();
  const status = snap.enabled ? "Running" : "Stopped";
  tray.setToolTip(`TFT Auto Queue - ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Status: ${status}`, enabled: false },
      { label: `Session Cycles: ${snap.sessionCycleCount}`, enabled: false },
      { label: `Total Cycles: ${snap.totalCycleCount}`, enabled: false },
      {
        label: snap.enabled ? "Stop (F1)" : "Start (F1)",
        click: () => {
          void toggleService();
        }
      },
      {
        label: "Show Window",
        click: () => {
          win?.show();
          win?.focus();
        }
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function broadcastState(): void {
  win?.webContents.send("state", service.getSnapshot());
}

async function toggleService(): Promise<void> {
  try {
    const enabled = await service.toggle();
    log(enabled ? "Service enabled by F1." : "Service disabled by F1.");
  } catch (err) {
    log(`Toggle failed: ${String(err)}`);
  } finally {
    updateTray();
    broadcastState();
  }
}

function registerHotkey(): void {
  const ok = globalShortcut.register("F1", () => {
    void toggleService();
  });
  log(ok ? "F1 registered." : "F1 registration failed.");
}

function registerIpc(): void {
  ipcMain.handle("toggle", async () => {
    await toggleService();
    return service.getSnapshot();
  });
  ipcMain.handle("initial-data", () => {
    return {
      state: service.getSnapshot()
    };
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("tft-auto-queue-next");
  tray = new Tray(icon());
  createWindow();
  registerIpc();
  registerHotkey();
  updateTray();
  broadcastState();
  stateBroadcastTimer = setInterval(() => {
    updateTray();
    broadcastState();
  }, 1000);
}

app.whenReady().then(() => {
  void bootstrap();
});

app.on("second-instance", () => {
  if (!win) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
});

app.on("will-quit", async () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (stateBroadcastTimer) {
    clearInterval(stateBroadcastTimer);
    stateBroadcastTimer = null;
  }
  await service.stop();
});

app.on("window-all-closed", () => {
  // keep tray app alive
});
