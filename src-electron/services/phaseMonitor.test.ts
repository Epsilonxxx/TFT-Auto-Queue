import { describe, expect, it } from "vitest";
import type { GameflowPhase } from "../lcu/client";
import { PhaseMonitor, type PhaseMonitorClient, type PhaseObservation } from "./phaseMonitor";

class FakePhaseMonitorClient implements PhaseMonitorClient {
  phase: GameflowPhase = "Lobby";
  private listener: ((phase: GameflowPhase) => void) | null = null;

  async get<T>(path: string): Promise<T> {
    if (path !== "/lol-gameflow/v1/gameflow-phase") {
      throw new Error(`Unexpected path: ${path}`);
    }

    return this.phase as T;
  }

  connectGameflowEvents(onPhase: (phase: GameflowPhase) => void): void {
    this.listener = onPhase;
  }

  emitPhase(phase: GameflowPhase): void {
    this.phase = phase;
    this.listener?.(phase);
  }
}

describe("PhaseMonitor", () => {
  it("forwards both event-driven and polled phase observations", async () => {
    const client = new FakePhaseMonitorClient();
    const observations: PhaseObservation[] = [];

    const monitor = new PhaseMonitor({
      client,
      pollIntervalMs: 1000,
      onPhase: (observation) => {
        observations.push(observation);
      },
      setIntervalFn: (() => 0 as ReturnType<typeof setInterval>),
      clearIntervalFn: () => {}
    });

    monitor.start();
    client.emitPhase("ReadyCheck");
    await monitor.tickOnce();
    monitor.stop();

    expect(observations).toEqual([
      { phase: "ReadyCheck", source: "event" },
      { phase: "ReadyCheck", source: "poll" }
    ]);
  });

  it("reports polling errors to the caller", async () => {
    const errors: unknown[] = [];
    const client: PhaseMonitorClient = {
      async get() {
        throw new Error("poll failed");
      },
      connectGameflowEvents() {
        // no-op
      }
    };

    const monitor = new PhaseMonitor({
      client,
      pollIntervalMs: 1000,
      onPhase: () => {},
      onPollError: (error) => {
        errors.push(error);
      },
      setIntervalFn: (() => 0 as ReturnType<typeof setInterval>),
      clearIntervalFn: () => {}
    });

    monitor.start();
    await monitor.tickOnce();
    monitor.stop();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("poll failed");
  });
});
