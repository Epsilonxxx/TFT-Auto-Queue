import type { GameflowPhase } from "../lcu/client";
import { isGameflowPhase } from "../lcu/client";

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
  private polling = false;
  private generation = 0;
  private eventRevision = 0;
  private pollTimer: IntervalHandle | null = null;
  private pollIntervalMs: number;
  private readonly client: PhaseMonitorClient;
  private readonly onPhase: (
    observation: PhaseObservation,
  ) => Promise<void> | void;
  private readonly onPollError?: (error: unknown) => Promise<void> | void;
  private readonly setIntervalFn: (
    callback: () => void,
    delay: number,
  ) => IntervalHandle;
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
    this.generation += 1;
    this.client.connectGameflowEvents((phase) => {
      if (!this.running) {
        return;
      }
      this.eventRevision += 1;
      const generation = this.generation;
      void Promise.resolve()
        .then(() => {
          if (this.running && generation === this.generation)
            return this.onPhase({ phase, source: "event" });
        })
        .catch((error) => {
          if (this.running)
            void Promise.resolve(this.onPollError?.(error)).catch(() => {});
        });
    });
    this.restartPolling();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.pollTimer !== null) {
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
    if (!this.running || this.polling) {
      return;
    }

    this.polling = true;
    const generation = this.generation;
    const eventRevision = this.eventRevision;
    try {
      const phase = await this.client.get<GameflowPhase>(
        "/lol-gameflow/v1/gameflow-phase",
      );
      if (
        !this.running ||
        generation !== this.generation ||
        eventRevision !== this.eventRevision
      )
        return;
      if (!isGameflowPhase(phase))
        throw new Error("Invalid gameflow phase received from client.");
      await this.onPhase({ phase, source: "poll" });
    } catch (error) {
      if (this.running && generation === this.generation)
        await this.onPollError?.(error);
    } finally {
      this.polling = false;
    }
  }

  private restartPolling(): void {
    if (this.pollTimer !== null) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }

    this.pollTimer = this.setIntervalFn(() => {
      void this.tickOnce();
    }, this.pollIntervalMs);
  }
}
