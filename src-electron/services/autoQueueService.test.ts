import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";
import { MemoryConfigStore, createDefaultAppConfig } from "../config/appConfig";
import type { GameflowPhase } from "../lcu/client";
import { AutoQueueService, type LcuClientLike } from "./autoQueueService";

function createAxiosFailure(status: number, data: unknown, message = "request failed"): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = {
    status,
    statusText: "",
    headers: {},
    config,
    data
  } as AxiosResponse;

  return new AxiosError(message, undefined, config, undefined, response);
}

class FakeLcuClient implements LcuClientLike {
  phase: GameflowPhase = "Lobby";
  hasLobby = true;
  queues = [{ id: 1220, name: "Tocker's Trials" }];
  readonly getCalls: string[] = [];
  readonly postCalls: Array<{ path: string; body?: unknown }> = [];
  readonly deleteCalls: string[] = [];
  closedCount = 0;

  private readonly queuedGetErrors = new Map<string, unknown[]>();
  private readonly queuedGetResponses = new Map<string, unknown[]>();
  private readonly queuedPostErrors = new Map<string, unknown[]>();
  private phaseListener: ((phase: GameflowPhase) => void) | null = null;

  queueGetError(path: string, error: unknown): void {
    const current = this.queuedGetErrors.get(path) ?? [];
    current.push(error);
    this.queuedGetErrors.set(path, current);
  }

  queueGetResponse(path: string, response: unknown): void {
    const current = this.queuedGetResponses.get(path) ?? [];
    current.push(response);
    this.queuedGetResponses.set(path, current);
  }

  queuePostError(path: string, error: unknown): void {
    const current = this.queuedPostErrors.get(path) ?? [];
    current.push(error);
    this.queuedPostErrors.set(path, current);
  }

  async get<T>(path: string): Promise<T> {
    this.getCalls.push(path);
    const queuedError = this.queuedGetErrors.get(path)?.shift();
    if (queuedError) {
      throw queuedError;
    }

    const queuedResponse = this.queuedGetResponses.get(path)?.shift();
    if (queuedResponse !== undefined) {
      return queuedResponse as T;
    }

    if (path === "/lol-gameflow/v1/gameflow-phase") {
      return this.phase as T;
    }
    if (path === "/lol-game-session/v1/reconnectInfo") {
      return {} as T;
    }
    if (path === "/lol-gameflow/v1/session") {
      return { phase: this.phase } as T;
    }
    if (path === "/lol-lobby/v2/notifications") {
      return [] as T;
    }
    if (path === "/lol-gameflow/v1/availability") {
      return { isAvailable: true } as T;
    }
    if (path === "/lol-lobby/v2/lobby") {
      if (!this.hasLobby) {
        throw createAxiosFailure(404, { message: "Lobby missing" });
      }
      return { queueId: 1220 } as T;
    }
    if (path === "/lol-game-queues/v1/queues") {
      return this.queues as T;
    }
    return {} as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.postCalls.push({ path, body });
    const queuedError = this.queuedPostErrors.get(path)?.shift();
    if (queuedError) {
      throw queuedError;
    }

    if (path === "/lol-lobby/v2/lobby") {
      this.hasLobby = true;
    }
    if (path === "/lol-gameflow/v1/session/request-lobby") {
      this.hasLobby = true;
    }

    return {} as T;
  }

  async delete<T>(path: string): Promise<T> {
    this.deleteCalls.push(path);
    if (path === "/lol-lobby/v2/lobby") {
      this.hasLobby = false;
    }
    return {} as T;
  }

  connectGameflowEvents(onPhase: (phase: GameflowPhase) => void): void {
    this.phaseListener = onPhase;
  }

  emitPhase(phase: GameflowPhase): void {
    this.phase = phase;
    this.phaseListener?.(phase);
  }

  close(): void {
    this.closedCount += 1;
  }
}

function createHarness(clients: FakeLcuClient[]) {
  let nowValue = 0;
  let createClientIndex = 0;
  const sleepCalls: number[] = [];
  const logs: string[] = [];
  let dismissCrashDialogCalls = 0;
  const configStore = new MemoryConfigStore(createDefaultAppConfig());

  const service = new AutoQueueService({
    configStore,
    discoverCredentials: () => ({ port: 2999, token: "token" }),
    createLcuClient: () => clients[Math.min(createClientIndex++, clients.length - 1)],
    logger: (message) => {
      logs.push(message);
    },
    now: () => nowValue,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      nowValue += ms;
    },
    randomBetween: () => 1500,
    setIntervalFn: (() => 0 as ReturnType<typeof setInterval>),
    clearIntervalFn: () => {},
    dismissCrashDialog: async () => {
      dismissCrashDialogCalls += 1;
      return "dismissed";
    }
  });

  return {
    service,
    configStore,
    logs,
    sleepCalls,
    getDismissCrashDialogCalls: () => dismissCrashDialogCalls,
    advanceTime: (ms: number) => {
      nowValue += ms;
    }
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AutoQueueService", () => {
  it("blocks matchmaking retries until the backoff window expires", async () => {
    const client = new FakeLcuClient();
    client.phase = "Lobby";
    client.queuePostError(
      "/lol-lobby/v2/lobby/matchmaking/search",
      createAxiosFailure(429, "Unable to enter matchmaking queue. Please try again later")
    );

    const harness = createHarness([client]);

    await harness.service.start();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(1);

    await harness.service.tickOnce();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(1);

    harness.advanceTime(3 * 60 * 1000 + 1);
    await harness.service.tickOnce();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(2);
  });

  it("returns to the home lobby and retries when players are not ready", async () => {
    const client = new FakeLcuClient();
    client.phase = "Lobby";
    client.queuePostError(
      "/lol-lobby/v2/lobby/matchmaking/search",
      createAxiosFailure(409, "Players are not ready")
    );

    const harness = createHarness([client]);

    await harness.service.start();

    expect(client.deleteCalls).toContain("/lol-lobby/v2/lobby");
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby")).toHaveLength(1);
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(2);
    expect(harness.sleepCalls).toContain(1200);
  });

  it("waits 5 minutes before retrying when join queue fails unexpectedly", async () => {
    const client = new FakeLcuClient();
    client.phase = "Lobby";
    client.queuePostError(
      "/lol-lobby/v2/lobby/matchmaking/search",
      createAxiosFailure(
        400,
        "Attempt to join queue failed. An unexpected error has occurred while attempting to join the queue. Please wait a few minutes and try again."
      )
    );

    const harness = createHarness([client]);

    await harness.service.start();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(1);

    harness.advanceTime(3 * 60 * 1000 + 1);
    await harness.service.tickOnce();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(1);

    harness.advanceTime(2 * 60 * 1000 + 1);
    await harness.service.tickOnce();
    expect(client.postCalls.filter((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toHaveLength(2);
    expect(harness.logs).toContain("Join queue failed unexpectedly. Retry after 5 minutes.");
  });

  it("accepts ready-check through gameflow events without waiting for the next poll", async () => {
    const client = new FakeLcuClient();
    client.phase = "Lobby";
    const harness = createHarness([client]);

    await harness.service.start();
    client.emitPhase("ReadyCheck");
    await flushAsyncWork();

    expect(client.postCalls.some((call) => call.path === "/lol-matchmaking/v1/ready-check/accept")).toBe(true);
    expect(harness.logs).toContain("Ready-check accepted.");
  });

  it("tries to recover the LCU connection after repeated phase read failures", async () => {
    const unstableClient = new FakeLcuClient();
    unstableClient.queueGetError("/lol-gameflow/v1/gameflow-phase", new Error("read failed"));
    unstableClient.queueGetError("/lol-gameflow/v1/gameflow-phase", new Error("read failed"));

    const recoveredClient = new FakeLcuClient();
    recoveredClient.phase = "Lobby";

    const harness = createHarness([unstableClient, recoveredClient]);

    await harness.service.start();
    await harness.service.tickOnce();

    expect(unstableClient.closedCount).toBe(1);
    expect(harness.logs).toContain("LCU connection unstable, trying recovery...");
    expect(harness.logs).toContain("LCU connection recovered.");
  });

  it("sends reconnect when the client enters a reconnect phase", async () => {
    const client = new FakeLcuClient();
    client.phase = "Reconnect";
    const harness = createHarness([client]);

    await harness.service.start();

    expect(client.postCalls.some((call) => call.path === "/lol-gameflow/v1/reconnect")).toBe(true);
    expect(harness.getDismissCrashDialogCalls()).toBe(1);
    expect(harness.logs).toContain("Reconnect state detected. Attempting automatic recovery.");
    expect(harness.logs).toContain("Detected League crash dialog. Dismissed it before reconnecting.");
  });

  it("returns to lobby instead of reconnecting when the API reports server connection loss", async () => {
    const client = new FakeLcuClient();
    client.phase = "Reconnect";
    client.hasLobby = false;
    client.queueGetResponse("/lol-game-session/v1/reconnectInfo", {
      playerFacingMessage: "Unable to connect to server"
    });
    const harness = createHarness([client]);

    await harness.service.start();

    expect(client.postCalls.some((call) => call.path === "/lol-gameflow/v1/session/request-lobby")).toBe(true);
    expect(client.postCalls.some((call) => call.path === "/lol-gameflow/v1/reconnect")).toBe(false);
    expect(client.postCalls.some((call) => call.path === "/lol-lobby/v2/lobby/matchmaking/search")).toBe(true);
    expect(harness.logs).toContain("Server connection lost. Returning to lobby and restarting queue.");
    expect(harness.logs).toContain("Requested return to lobby.");
  });

  it("sends reconnect when the client enters an error phase", async () => {
    const client = new FakeLcuClient();
    client.phase = "TerminatedInError";
    const harness = createHarness([client]);

    await harness.service.start();

    expect(client.postCalls.some((call) => call.path === "/lol-gameflow/v1/reconnect")).toBe(true);
    expect(harness.logs).toContain("Client error state detected. Attempting automatic recovery.");
  });

  it("reconnects once a game cycle exceeds the configured timeout", async () => {
    const client = new FakeLcuClient();
    client.phase = "InProgress";
    const harness = createHarness([client]);
    harness.service.updateSettings({ cycleReconnectTimeoutMs: 5000 });

    await harness.service.start();

    harness.advanceTime(5000);
    await harness.service.tickOnce();

    expect(client.postCalls.filter((call) => call.path === "/lol-gameflow/v1/reconnect")).toHaveLength(1);
    expect(harness.logs).toContain("Cycle exceeded timeout. Attempting reconnect recovery.");

    harness.advanceTime(4000);
    await harness.service.tickOnce();
    expect(client.postCalls.filter((call) => call.path === "/lol-gameflow/v1/reconnect")).toHaveLength(1);
  });

  it("persists completed cycle counters into the config store", async () => {
    const client = new FakeLcuClient();
    client.phase = "InProgress";
    const harness = createHarness([client]);

    await harness.service.start();
    client.phase = "PreEndOfGame";
    await harness.service.tickOnce();

    expect(harness.configStore.get().stats).toEqual({
      totalCycleCount: 1,
      sessionCycleCount: 1
    });
  });
});
