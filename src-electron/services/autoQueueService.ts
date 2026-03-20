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
  cycleCount: number;
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
  private cycleCount = 0;
  private activeQueueId = 1220;
  private activeQueueName = "Tocker's Trials";
  private readonly delayMinMs = 1000;
  private readonly delayMaxMs = 2000;

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
      cycleCount: this.cycleCount
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

    const creds = discoverLcuCredentials();
    this.lcu = new LcuClient(creds);
    const queue = await this.resolveQueue();
    this.activeQueueId = queue.id;
    this.activeQueueName = queue.name;
    this.enabled = true;

    this.lcu.connectGameflowEvents((phase) => {
      void this.handlePhase(phase);
    });

    this.pollTimer = setInterval(() => {
      void this.tick();
    }, 2500);

    log(`Enabled for queue: ${this.activeQueueName} (${this.activeQueueId})`);
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
    log("Disabled.");
  }

  private async tick(): Promise<void> {
    if (!this.enabled || !this.lcu) {
      return;
    }
    try {
      const phase = await this.lcu.get<GameflowPhase>("/lol-gameflow/v1/gameflow-phase");
      await this.handlePhase(phase);
    } catch (err) {
      log(`Phase read failed: ${String(err)}`);
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
        this.cycleCount += 1;
        log(`Cycle completed: ${this.cycleCount}`);
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
    log(`Lobby created for ${this.activeQueueName}.`);
  }

  private async ensureSearch(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    await this.applyHumanizedDelay("matchmaking-search");
    try {
      await this.lcu.post("/lol-lobby/v2/lobby/matchmaking/search");
      log("Search started.");
    } catch (err) {
      if (isHttpStatus(err, 400) || isHttpStatus(err, 409)) {
        return;
      }
      throw err;
    }
  }

  private async acceptReadyCheck(): Promise<void> {
    if (!this.lcu) {
      return;
    }
    await this.applyHumanizedDelay("ready-check-accept");
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

  private async applyHumanizedDelay(action: string): Promise<void> {
    const delayMs = randomBetween(this.delayMinMs, this.delayMaxMs);
    log(`Delay ${delayMs}ms before ${action}.`);
    await sleep(delayMs);
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
}
