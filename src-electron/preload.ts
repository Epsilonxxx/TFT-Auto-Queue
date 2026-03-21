import { contextBridge, ipcRenderer } from "electron";
import type { ServiceSnapshot } from "./services/autoQueueService";

type InitialData = {
  state: ServiceSnapshot;
  logs: string[];
};

contextBridge.exposeInMainWorld("tftApi", {
  toggle: () => ipcRenderer.invoke("toggle"),
  getInitialData: () => ipcRenderer.invoke("initial-data") as Promise<InitialData>,
  onState: (listener: (state: ServiceSnapshot) => void) => {
    const handler = (_event: unknown, state: ServiceSnapshot) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
  onLog: (listener: (line: string) => void) => {
    const handler = (_event: unknown, line: string) => listener(line);
    ipcRenderer.on("log", handler);
    return () => ipcRenderer.removeListener("log", handler);
  }
});
