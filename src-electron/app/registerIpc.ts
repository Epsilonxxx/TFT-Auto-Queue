import { ipcMain } from "electron";
import type { ServiceSnapshot } from "../services/autoQueueService";
import type { AppSettings } from "../config/appConfig";

type InitialData = {
  state: ServiceSnapshot;
  settings: AppSettings;
};

export type RegisterIpcOptions = {
  onToggle: () => Promise<ServiceSnapshot>;
  getInitialData: () => InitialData;
  saveSettings: (settings: Partial<AppSettings>) => AppSettings;
};

export function registerIpcHandlers(options: RegisterIpcOptions): () => void {
  ipcMain.handle("toggle", options.onToggle);
  ipcMain.handle("initial-data", options.getInitialData);
  ipcMain.handle("save-settings", (_event, settings: Partial<AppSettings>) => options.saveSettings(settings));

  return () => {
    ipcMain.removeHandler("toggle");
    ipcMain.removeHandler("initial-data");
    ipcMain.removeHandler("save-settings");
  };
}
