import dotenv from "dotenv";
import { AxiosError } from "axios";
import { discoverLcuCredentials } from "../lcu/discovery";
import { GameflowPhase, LcuClient } from "../lcu/client";
import { log } from "../utils/logger";

dotenv.config();

type Lobby = { queueId: number };

type GameQueue = {
  id: number;
  name?: string;
  shortName?: string;
  description?: string;
  detailedDescription?: string;
  gameMode?: string;
  category?: string;
  map?: string;
};

export type ServiceSnapshot = {
  enabled: boolean;
  queueId: number;
  queueName: string;
  phase: string;
  totalCycleCount: number;
  sessionCycleCount: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof AxiosError && err.response?.status === status;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function isTockersTrialsQueue(queue: GameQueue): boolean {
  if (queue.id === 1220) {
    return true;
  }
  const raw = [
    queue.name ?? "",
    queue.shortName ?? "",
    queue.description ?? "",
    queue.detailedDescription ?? "",
    queue.gameMode ?? "",
    queue.category ?? "",
    queue.map ?? ""
  ].join(" ");
  const normalized = normalizeText(raw);
  return raw.includes("发条鸟的试炼") || normalized.includes("tockerstrials");
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extractErrorText(err: unknown): string {
  if (!(err instanceof AxiosError)) {
    return String(err ?? "");
  }
  const data = err.response?.data;
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    return JSON.stringify(data);
  }
  return err.message ?? "";
}

function isQueueLimitedError(err: unknown): boolean {
  const text = extractErrorText(err).toLowerCase();
  return (
    text.includes("无法进入匹配队列，请稍后再试") ||
    text.includes("unable to enter matchmaking queue") ||
    text.includes("please try again later")
  );
}

function isPlayersNotReadyError(err: unknown): boolean {
  const text = extractErrorText(err).toLowerCase();
  return (
    text.includes("players are not ready") ||
    text.includes("玩家尚未完成准备") ||
    text.includes("player has not finished ready")
  );
}

export class AutoQueueService {
  private lcu: LcuClient | null = null;
  private enabled = false;
  private processing = false;
  private readonly configuredQueueId: number | null;
  private readonly autoCancelOnDisable: boolean;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastPhase: GameflowPhase | null = null;
  private lastPostGameActionAt = 0;
  private inCurrentMatch = false;

  private totalCycleCount = 0;
  private sessionCycleCount = 0;

  private activeQueueId = 1220;
  private activeQueueName = "Tocker's Trials";

  private readonly postGameDelayMinMs = 1000;
  private readonly postGameDelayMaxMs = 2000;
  private pendingPostGameSearchDelay = false;

  private readonly queueRetryBlockMs = 3 * 60 * 1000;
  private searchBlockedUntil = 0;
  private lastBlockedLogAt = 0;

  private lastHomeResetAt = 0;
  private readonly homeResetCooldownMs = 10 * 1000;

  private readonly reconnectCooldownMs = 5000;
  private reconnecting = false;
  private consecutiveTickFailures = 0;
  private lastReconnectAt = 0;

  constructor() {
    const queueIdRaw = (process.env.TFT_QUEUE_ID ?? "").trim();
    this.configuredQueueId = queueIdRaw ? Number(queueIdRaw) : null;
    this.autoCancelOnDisable = (process.env.AUTO_CANCEL_ON_DISABLE ?? "true").toLowerCase() === "true";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getSnapshot(): ServiceSnapshot {
    return {
      enabled: this.enabled,
      queueId: this.activeQueueId,
      queueName: this.activeQueueName,
      phase: this.lastPhase ?? "Unknown",
      totalCycleCount: this.totalCycleCount,
      sessionCycleCount: this.sessionCycleCount
    };
  }

  async toggle(): Promise<boolean> {
    if (this.enabled) {
      await this.stop();
      return false;
    }
    await this.start();
    return true;
  }

  async start(): Promise<void> {
    if (this.enabled) {
      return;
    }

    await this.initializeLcuAndQueue();
    this.enabled = true;
    this.sessionCycleCount = 0;
    this.connectPhaseEvents();

    this.pollTimer = setInterval(() => {
      void this.tick();
    }, 2500);

    log(`Enabled for queue: ${this.activeQueueName}`);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.autoCancelOnDisable && this.lcu) {
      try {
        await this.lcu.delete("/lol-lobby/v2/lobby/matchmaking/search");
      } catch {
        // ignore
      }
    }

    this.lcu?.close();
    this.lcu = null;
    this.lastPhase = null;
    this.lastPostGameActionAt = 0;
    this.inCurrentMatch = false;
    this.pendingPostGameSearchDelay = false;
    this.searchBlockedUntil = 0;
    this.lastBlockedLogAt = 0;
    this.consecutiveTickFailures = 0;
    this.reconnecting = false;
    log("Disabled.");
  }

  private async tick(): Promise<void> {
    if (!this.enabled || !this.lcu) {
      return;
    }

    try {
      const phase = await this.lcu.get<GameflowPhase>("/lol-gameflow/v1/gameflow-phase");
      this.consecutiveTickFailures = 0;
      await this.handlePhase(phase);
    } catch (err) {
      this.consecutiveTickFailures += 1;
      log(`Phase read failed: ${String(err)}`);
      if (this.consecutiveTickFailures >= 2) {
        await this.tryRecoverLcuConnection();
      }
    }
  }

  private async handlePhase(phase: GameflowPhase): Promise<void> {
    if (!this.enabled || !this.lcu || this.processing) {
      return;
    }

    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      log(`Phase: ${phase}`);
    }

    if (phase === "InProgress") {
      this.inCurrentMatch = true;
    }

    if (phase === "PreEndOfGame" || phase === "EndOfGame" || phase === "WaitingForStats") {
      if (this.inCurrentMatch) {
        this.inCurrentMatch = false;
        this.totalCycleCount += 1;
        this.sessionCycleCount += 1;
        this.pendingPostGameSearchDelay = true;
        log(`Cycle completed. Session=${this.sessionCycleCount}, Total=${this.totalCycleCount}`);
      }
    } else {
      this.lastPostGameActionAt = 0;
    }

    this.processing = true;
    try {
      switch (phase) {
        case "None":
          await this.ensureLobbyAndSearch();
          break;
        case "Lobby":
          await this.ensureSearch();
          break;
        case "ReadyCheck":
          await this.acceptReadyCheck();
          break;
        case "PreEndOfGame":
        case "EndOfGame":
        case "WaitingForStats":
          await this.handlePostGamePhase();
          break;
        case "Reconnect":
          await this.tryReconnectGameSession();
          break;
        default:
          break;
      }
    } finally {
      this.processing = false;
    }
  }

  private async ensureLobbyAndSearch(): Promise<void> {
    await this.ensureLobby();
    await sleep(300);
    await this.ensureSearch();
  }

  private async ensureLobby(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    try {
      await this.lcu.get<Lobby>("/lol-lobby/v2/lobby");
      return;
    } catch (err) {
      if (!isHttpStatus(err, 404)) {
        throw err;
      }
    }
    await this.lcu.post("/lol-lobby/v2/lobby", { queueId: this.activeQueueId });
    log("Lobby created.");
  }

  private async ensureSearch(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = Date.now();
    if (now < this.searchBlockedUntil) {
      if (now - this.lastBlockedLogAt > 15000) {
        const leftSec = Math.ceil((this.searchBlockedUntil - now) / 1000);
        log(`Queue retry blocked, waiting ${leftSec}s.`);
        this.lastBlockedLogAt = now;
      }
      return;
    }

    if (this.pendingPostGameSearchDelay) {
      const delayMs = randomBetween(this.postGameDelayMinMs, this.postGameDelayMaxMs);
      log(`Post-game requeue delay: ${delayMs}ms.`);
      await sleep(delayMs);
      this.pendingPostGameSearchDelay = false;
    }

    try {
      await this.lcu.post("/lol-lobby/v2/lobby/matchmaking/search");
      log("Search started.");
    } catch (err) {
      if (isPlayersNotReadyError(err)) {
        log("Players are not ready. Leaving current lobby and retrying.");
        await this.recoverToHomeAndRetry();
        return;
      }

      if (isQueueLimitedError(err)) {
        this.searchBlockedUntil = Date.now() + this.queueRetryBlockMs;
        this.lastBlockedLogAt = 0;
        log("Queue limited by server. Retry after 3 minutes.");
        return;
      }

      if (isHttpStatus(err, 400) || isHttpStatus(err, 409) || isHttpStatus(err, 429)) {
        return;
      }
      throw err;
    }
  }

  private async recoverToHomeAndRetry(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = Date.now();
    if (now - this.lastHomeResetAt < this.homeResetCooldownMs) {
      return;
    }
    this.lastHomeResetAt = now;

    try {
      await this.lcu.delete("/lol-lobby/v2/lobby");
      log("Current lobby closed.");
    } catch {
      // ignore if lobby already gone
    }

    await sleep(1200);
    await this.ensureLobbyAndSearch();
  }

  private async acceptReadyCheck(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    try {
      await this.lcu.post("/lol-matchmaking/v1/ready-check/accept");
      log("Ready-check accepted.");
    } catch (err) {
      if (isHttpStatus(err, 404)) {
        return;
      }
      throw err;
    }
  }

  private async handlePostGamePhase(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    const now = Date.now();
    if (now - this.lastPostGameActionAt < 2000) {
      return;
    }
    this.lastPostGameActionAt = now;

    const playAgain = await this.tryPost("/lol-lobby/v2/play-again");
    if (playAgain) {
      log("Post-game: play-again sent.");
      return;
    }

    const dismiss = await this.tryPost("/lol-end-of-game/v1/state/dismiss-stats");
    if (dismiss) {
      log("Post-game: dismiss-stats sent.");
    }
  }

  private async tryReconnectGameSession(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    try {
      await this.lcu.post("/lol-gameflow/v1/reconnect");
      log("Reconnect command sent.");
    } catch (err) {
      if (isHttpStatus(err, 400) || isHttpStatus(err, 404) || isHttpStatus(err, 409) || isHttpStatus(err, 422)) {
        return;
      }
      log(`Reconnect request failed: ${String(err)}`);
    }
  }

  private async tryPost(path: string): Promise<boolean> {
    if (!this.lcu) {
      return false;
    }
    try {
      await this.lcu.post(path);
      return true;
    } catch (err) {
      if (isHttpStatus(err, 400) || isHttpStatus(err, 404) || isHttpStatus(err, 409) || isHttpStatus(err, 422)) {
        return false;
      }
      log(`Request failed ${path}: ${String(err)}`);
      return false;
    }
  }

  private async resolveQueue(): Promise<{ id: number; name: string }> {
    if (this.configuredQueueId && Number.isFinite(this.configuredQueueId)) {
      return { id: this.configuredQueueId, name: "Manual Queue" };
    }
    if (!this.lcu) {
      return { id: 1220, name: "Tocker's Trials" };
    }
    const queues = await this.lcu.get<GameQueue[]>("/lol-game-queues/v1/queues");
    const found = queues.find((q) => isTockersTrialsQueue(q));
    if (!found) {
      throw new Error("Tocker's Trials queue not found.");
    }
    return { id: found.id, name: found.name ?? found.shortName ?? "Tocker's Trials" };
  }

  private async initializeLcuAndQueue(): Promise<void> {
    const creds = discoverLcuCredentials();
    this.lcu = new LcuClient(creds);
    const queue = await this.resolveQueue();
    this.activeQueueId = queue.id;
    this.activeQueueName = queue.name;
  }

  private connectPhaseEvents(): void {
    if (!this.lcu) {
      return;
    }
    this.lcu.connectGameflowEvents((phase) => {
      void this.handlePhase(phase);
    });
  }

  private async tryRecoverLcuConnection(): Promise<void> {
    if (!this.enabled || this.reconnecting) {
      return;
    }
    const now = Date.now();
    if (now - this.lastReconnectAt < this.reconnectCooldownMs) {
      return;
    }

    this.lastReconnectAt = now;
    this.reconnecting = true;
    try {
      log("LCU connection unstable, trying recovery...");
      this.lcu?.close();
      await this.initializeLcuAndQueue();
      this.connectPhaseEvents();
      this.consecutiveTickFailures = 0;
      log("LCU connection recovered.");
    } catch (err) {
      log(`LCU recovery failed: ${String(err)}`);
    } finally {
      this.reconnecting = false;
    }
  }
}
