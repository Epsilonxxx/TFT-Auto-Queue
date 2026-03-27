export type AppLanguage = "zh-CN" | "en-US";

export type AppSettings = {
  language: AppLanguage;
  queueId: number | null;
  autoCancelOnDisable: boolean;
  scheduledRestartHours: number;
  postGameDelayMinMs: number;
  postGameDelayMaxMs: number;
  queueRetryBlockMs: number;
  homeResetCooldownMs: number;
  reconnectCooldownMs: number;
  cycleReconnectTimeoutMs: number;
  pollIntervalMs: number;
};

export type ServiceSnapshot = {
  enabled: boolean;
  queueId: number;
  queueName: string;
  phase: string;
  totalCycleCount: number;
  sessionCycleCount: number;
};

export type InitialData = {
  state: ServiceSnapshot;
  settings: AppSettings;
};

declare global {
  interface Window {
    tftApi: {
      toggle: () => Promise<ServiceSnapshot>;
      getInitialData: () => Promise<InitialData>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
      onState: (listener: (state: ServiceSnapshot) => void) => () => void;
    };
  }
}
