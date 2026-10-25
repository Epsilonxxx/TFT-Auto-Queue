import { describe, expect, it, vi } from "vitest";
import type { GameflowPhase } from "../lcu/client";
import {
  PhaseMonitor,
  type PhaseMonitorClient,
  type PhaseObservation,
} from "./phaseMonitor";

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
  it("does not overlap polls or deliver a stale poll after stopping", async () => {
    let resolve!: (phase: GameflowPhase) => void;
    const get = vi.fn(
      () =>
        new Promise<GameflowPhase>((done) => {
          resolve = done;
        }),
    );
    const onPhase = vi.fn();
    const monitor = new PhaseMonitor({
      client: { get: get as never, connectGameflowEvents() {} },
      pollIntervalMs: 1000,
      onPhase,
      setIntervalFn: () => 0 as never,
      clearIntervalFn: () => {},
    });
    monitor.start();
    const pending = monitor.tickOnce();
    await monitor.tickOnce();
    expect(get).toHaveBeenCalledTimes(1);
    monitor.stop();
    resolve("Lobby");
    await pending;
    expect(onPhase).not.toHaveBeenCalled();
  });

  it("discards an older poll when a newer phase event arrives", async () => {
    let resolve!: (phase: GameflowPhase) => void;
    const client = new FakePhaseMonitorClient();
    client.get = () =>
      new Promise((done) => {
        resolve = done as never;
      });
    const onPhase = vi.fn();
    const monitor = new PhaseMonitor({
      client,
      pollIntervalMs: 1000,
      onPhase,
      setIntervalFn: () => 0 as never,
      clearIntervalFn: () => {},
    });
    monitor.start();
    const pending = monitor.tickOnce();
    client.emitPhase("ReadyCheck");
    resolve("Lobby");
    await pending;
    expect(onPhase.mock.calls.map(([value]) => value.phase)).toEqual([
      "ReadyCheck",
    ]);
    monitor.stop();
  });
  it("forwards both event-driven and polled phase observations", async () => {
    const client = new FakePhaseMonitorClient();
    const observations: PhaseObservation[] = [];

    const monitor = new PhaseMonitor({
      client,
      pollIntervalMs: 1000,
      onPhase: (observation) => {
        observations.push(observation);
      },
      setIntervalFn: () => 0 as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });

    monitor.start();
    client.emitPhase("ReadyCheck");
    await monitor.tickOnce();
    monitor.stop();

    expect(observations).toEqual([
      { phase: "ReadyCheck", source: "event" },
      { phase: "ReadyCheck", source: "poll" },
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
      },
    };

    const monitor = new PhaseMonitor({
      client,
      pollIntervalMs: 1000,
      onPhase: () => {},
      onPollError: (error) => {
        errors.push(error);
      },
      setIntervalFn: () => 0 as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });

    monitor.start();
    await monitor.tickOnce();
    monitor.stop();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("poll failed");
  });
});
