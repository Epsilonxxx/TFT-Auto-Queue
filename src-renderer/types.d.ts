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
};

declare global {
  interface Window {
    tftApi: {
      toggle: () => Promise<ServiceSnapshot>;
      getInitialData: () => Promise<InitialData>;
      onState: (listener: (state: ServiceSnapshot) => void) => () => void;
    };
  }
}
