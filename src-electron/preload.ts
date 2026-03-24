import { contextBridge, ipcRenderer } from "electron";
import type { ServiceSnapshot } from "./services/autoQueueService";

type InitialData = {
  state: ServiceSnapshot;
};

contextBridge.exposeInMainWorld("tftApi", {
  toggle: () => ipcRenderer.invoke("toggle"),
  getInitialData: () => ipcRenderer.invoke("initial-data") as Promise<InitialData>,
  onState: (listener: (state: ServiceSnapshot) => void) => {
    const handler = (_event: unknown, state: ServiceSnapshot) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  }
});
