import type { AppSettings } from "../src-electron/config/appConfig";
import type { ServiceSnapshot } from "../src-electron/services/autoQueueService";
export type {
  AppSettings,
  AppLanguage,
} from "../src-electron/config/appConfig";
export type { ServiceSnapshot } from "../src-electron/services/autoQueueService";

export type InitialData = {
  state: ServiceSnapshot;
  settings: AppSettings;
  defaults: AppSettings;
  version: string;
};

declare global {
  interface Window {
    tftApi: {
      toggle: () => Promise<ServiceSnapshot>;
      getInitialData: () => Promise<InitialData>;
      checkClient: () => Promise<{ ok: boolean; message: string }>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
      onState: (listener: (state: ServiceSnapshot) => void) => () => void;
    };
  }
}
