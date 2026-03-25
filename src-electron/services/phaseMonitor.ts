import type { GameflowPhase } from "../lcu/client";

type IntervalHandle = ReturnType<typeof setInterval>;

export type PhaseObservation = {
  phase: GameflowPhase;
  source: "event" | "poll";
};

export type PhaseMonitorClient = {
  get<T>(path: string): Promise<T>;
  connectGameflowEvents(onPhase: (phase: GameflowPhase) => void): void;
};

export type PhaseMonitorOptions = {
  client: PhaseMonitorClient;
  pollIntervalMs: number;
  onPhase: (observation: PhaseObservation) => Promise<void> | void;
  onPollError?: (error: unknown) => Promise<void> | void;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
};

export class PhaseMonitor {
  private running = false;
  private pollTimer: IntervalHandle | null = null;
  private pollIntervalMs: number;
  private readonly client: PhaseMonitorClient;
  private readonly onPhase: (observation: PhaseObservation) => Promise<void> | void;
  private readonly onPollError?: (error: unknown) => Promise<void> | void;
  private readonly setIntervalFn: (callback: () => void, delay: number) => IntervalHandle;
  private readonly clearIntervalFn: (handle: IntervalHandle) => void;

  constructor(options: PhaseMonitorOptions) {
    this.client = options.client;
    this.pollIntervalMs = options.pollIntervalMs;
    this.onPhase = options.onPhase;
    this.onPollError = options.onPollError;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.client.connectGameflowEvents((phase) => {
      if (!this.running) {
        return;
      }
      void this.onPhase({ phase, source: "event" });
    });
    this.restartPolling();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  setPollInterval(pollIntervalMs: number): void {
    this.pollIntervalMs = pollIntervalMs;
    if (this.running) {
      this.restartPolling();
    }
  }

  async tickOnce(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const phase = await this.client.get<GameflowPhase>("/lol-gameflow/v1/gameflow-phase");
      await this.onPhase({ phase, source: "poll" });
    } catch (error) {
      await this.onPollError?.(error);
    }
  }

  private restartPolling(): void {
    if (this.pollTimer) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }

    this.pollTimer = this.setIntervalFn(() => {
      void this.tickOnce();
    }, this.pollIntervalMs);
  }
}
