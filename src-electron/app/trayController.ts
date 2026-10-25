import path from "node:path";
import { Menu, Tray, nativeImage } from "electron";
import type { ServiceSnapshot } from "../services/autoQueueService";

export type TrayControllerOptions = {
  onToggle: () => void;
  onShow: () => void;
  onExit: () => void;
  getLanguage: () => "zh-CN" | "en-US";
};

function truncateMenuText(value: string, maxLength = 72): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 3)}...`;
}

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath, "assets", "tray.png"),
    path.join(__dirname, "..", "..", "assets", "tray.png"),
  ];

  for (const iconPath of candidates) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPUlEQVR4Ae3WQQEAAAgDIN8/9K3hHFQgYJpQJ8wYDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBwN9YhAT8gD8X8AAAAAElFTkSuQmCC",
  );
}

export class TrayController {
  private tray: Tray | null = null;
  private lastSignature = "";

  constructor(private readonly options: TrayControllerOptions) {}

  create(): Tray {
    if (this.tray) {
      return this.tray;
    }

    this.tray = new Tray(resolveTrayIcon());
    this.tray.on("double-click", this.options.onShow);
    return this.tray;
  }

  update(snapshot: ServiceSnapshot): void {
    if (!this.tray) {
      return;
    }

    const zh = this.options.getLanguage() === "zh-CN";
    const status =
      snapshot.connection === "reconnecting"
        ? zh
          ? "重连中"
          : "Reconnecting"
        : snapshot.enabled
          ? zh
            ? "运行中"
            : "Running"
          : snapshot.lastError
            ? zh
              ? "异常"
              : "Error"
            : zh
              ? "已停止"
              : "Stopped";
    const signature = JSON.stringify([
      zh,
      status,
      snapshot.lastError,
      snapshot.sessionCycleCount,
      snapshot.totalCycleCount,
    ]);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.tray.setToolTip(`TFT Auto Queue - ${status}`);

    const errorItem = snapshot.lastError
      ? [
          {
            label: `${zh ? "错误" : "Error"}: ${truncateMenuText(snapshot.lastError)}`,
            enabled: false,
          } as const,
        ]
      : [];

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${zh ? "状态" : "Status"}: ${status}`, enabled: false },
        {
          label: `${zh ? "本次完成" : "Session Cycles"}: ${snapshot.sessionCycleCount}`,
          enabled: false,
        },
        {
          label: `${zh ? "累计完成" : "Total Cycles"}: ${snapshot.totalCycleCount}`,
          enabled: false,
        },
        ...errorItem,
        {
          label: snapshot.enabled
            ? zh
              ? "停止 (F1)"
              : "Stop (F1)"
            : zh
              ? "启动 (F1)"
              : "Start (F1)",
          click: this.options.onToggle,
        },
        {
          label: zh ? "显示窗口" : "Show Window",
          click: this.options.onShow,
        },
        { type: "separator" },
        {
          label: zh ? "退出" : "Exit",
          click: this.options.onExit,
        },
      ]),
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
