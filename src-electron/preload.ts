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
    ipcRenderer.on("state", (_event, state: ServiceSnapshot) => listener(state));
  },
  onLog: (listener: (line: string) => void) => {
    ipcRenderer.on("log", (_event, line: string) => listener(line));
  }
});
