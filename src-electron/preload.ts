import { contextBridge, ipcRenderer } from "electron";
import type { ServiceSnapshot } from "./services/autoQueueService";
import type { AppSettings } from "./config/appConfig";

type InitialData = {
  state: ServiceSnapshot;
  settings: AppSettings;
};

contextBridge.exposeInMainWorld("tftApi", {
  toggle: () => ipcRenderer.invoke("toggle"),
  getInitialData: () => ipcRenderer.invoke("initial-data") as Promise<InitialData>,
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("save-settings", settings) as Promise<AppSettings>,
  onState: (listener: (state: ServiceSnapshot) => void) => {
    const handler = (_event: unknown, state: ServiceSnapshot) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  }
});
