import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ServiceSnapshot } from "../services/autoQueueService";
import type { AppSettings } from "../config/appConfig";

type InitialData = {
  state: ServiceSnapshot;
  settings: AppSettings;
  defaults: AppSettings;
  version: string;
};

export type RegisterIpcOptions = {
  onToggle: () => Promise<ServiceSnapshot>;
  getInitialData: () => InitialData;
  saveSettings: (settings: Partial<AppSettings>) => AppSettings;
  checkClient: () => Promise<{ ok: boolean; message: string }>;
  trustedWebContentsId: () => number | undefined;
};

export function registerIpcHandlers(options: RegisterIpcOptions): () => void {
  const validate = (event: IpcMainInvokeEvent) => {
    if (
      event.sender.id !== options.trustedWebContentsId() ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Untrusted IPC sender.");
    }
  };
  ipcMain.handle("toggle", (event) => {
    validate(event);
    return options.onToggle();
  });
  ipcMain.handle("initial-data", (event) => {
    validate(event);
    return options.getInitialData();
  });
  ipcMain.handle("check-client", (event) => {
    validate(event);
    return options.checkClient();
  });
  ipcMain.handle("save-settings", (event, settings: Partial<AppSettings>) => {
    validate(event);
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error("Invalid settings.");
    return options.saveSettings(settings);
  });

  return () => {
    ipcMain.removeHandler("toggle");
    ipcMain.removeHandler("initial-data");
    ipcMain.removeHandler("save-settings");
    ipcMain.removeHandler("check-client");
  };
}
