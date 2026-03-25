import { BrowserWindow } from "electron";
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
      width: 1040,
      height: 560,
      minWidth: 360,
      minHeight: 420,
      autoHideMenuBar: true,
      backgroundColor: "#f6f8fb",
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    void this.window.loadFile(this.options.indexPath);
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
    this.window?.show();
    this.window?.focus();
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
    this.window?.webContents.send("state", snapshot);
  }
}
