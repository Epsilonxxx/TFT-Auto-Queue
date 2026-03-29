import path from "node:path";
import { Menu, Tray, nativeImage } from "electron";
import type { ServiceSnapshot } from "../services/autoQueueService";

export type TrayControllerOptions = {
  onToggle: () => void;
  onShow: () => void;
  onExit: () => void;
};

function truncateMenuText(value: string, maxLength = 72): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath, "assets", "tray.png"),
    path.join(__dirname, "..", "..", "assets", "tray.png")
  ];

  for (const iconPath of candidates) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPUlEQVR4Ae3WQQEAAAgDIN8/9K3hHFQgYJpQJ8wYDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBwN9YhAT8gD8X8AAAAAElFTkSuQmCC"
  );
}

export class TrayController {
  private tray: Tray | null = null;

  constructor(private readonly options: TrayControllerOptions) {}

  create(): Tray {
    if (this.tray) {
      return this.tray;
    }

    this.tray = new Tray(resolveTrayIcon());
    return this.tray;
  }

  update(snapshot: ServiceSnapshot): void {
    if (!this.tray) {
      return;
    }

    const status = snapshot.enabled ? "Running" : snapshot.lastError ? "Error" : "Stopped";
    this.tray.setToolTip(`TFT Auto Queue - ${status}`);

    const errorItem = snapshot.lastError
      ? [
          {
            label: `Error: ${truncateMenuText(snapshot.lastError)}`,
            enabled: false
          } as const
        ]
      : [];

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Status: ${status}`, enabled: false },
        { label: `Session Cycles: ${snapshot.sessionCycleCount}`, enabled: false },
        { label: `Total Cycles: ${snapshot.totalCycleCount}`, enabled: false },
        ...errorItem,
        {
          label: snapshot.enabled ? "Stop (F1)" : "Start (F1)",
          click: this.options.onToggle
        },
        {
          label: "Show Window",
          click: this.options.onShow
        },
        { type: "separator" },
        {
          label: "Exit",
          click: this.options.onExit
        }
      ])
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
