export type ServiceSnapshot = {
  enabled: boolean;
  queueId: number;
  queueName: string;
  phase: string;
  cycleCount: number;
};

export type InitialData = {
  state: ServiceSnapshot;
  logs: string[];
};

declare global {
  interface Window {
    tftApi: {
      toggle: () => Promise<ServiceSnapshot>;
      getInitialData: () => Promise<InitialData>;
      onState: (listener: (state: ServiceSnapshot) => void) => () => void;
      onLog: (listener: (line: string) => void) => () => void;
    };
  }
}
