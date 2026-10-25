import { BrowserWindow } from "electron";
import path from "node:path";
import type { ServiceSnapshot } from "../services/autoQueueService";

export type WindowManagerOptions = {
  preloadPath: string;
  indexPath: string;
  shouldHideOnClose: () => boolean;
};

export class WindowManager {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: WindowManagerOptions) {}

  create(): BrowserWindow {
    if (this.window) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 360,
      minHeight: 420,
      autoHideMenuBar: true,
      backgroundColor: "#f6f6f2",
      icon: path.join(__dirname, "..", "..", "assets", "app-icon.png"),
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    void this.window.loadFile(this.options.indexPath);
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
    this.window.on("closed", () => {
      this.window = null;
    });
    this.window.on("close", (event) => {
      if (!this.options.shouldHideOnClose()) {
        return;
      }
      event.preventDefault();
      this.window?.hide();
    });

    return this.window;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  show(): void {
    this.focusExisting();
  }

  focusExisting(): void {
    if (!this.window) {
      return;
    }
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    this.window.show();
    this.window.focus();
  }

  broadcastState(snapshot: ServiceSnapshot): void {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send("state", snapshot);
  }
}
