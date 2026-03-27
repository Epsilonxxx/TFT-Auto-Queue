import { AxiosError } from "axios";
import {
  AppConfigStore,
  MemoryConfigStore,
  createDefaultAppConfig,
  normalizeAppConfig,
  type AppSettings
} from "../config/appConfig";
import type { GameflowPhase, LcuClient } from "../lcu/client";
import { LcuClient as RiotLcuClient } from "../lcu/client";
import type { LcuCredentials } from "../lcu/discovery";
import { discoverLcuCredentials } from "../lcu/discovery";
import { LeagueClientController } from "../utils/leagueClientController";
import { log } from "../utils/logger";
import { SystemErrorRecovery } from "../utils/systemErrorRecovery";
import { PhaseMonitor, type PhaseObservation } from "./phaseMonitor";
import { QueueStateMachine, type QueueFlowContext } from "./queueFlowStates";
import { QueueSessionState } from "./queueSessionState";

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

export type LcuClientLike = Pick<LcuClient, "get" | "post" | "delete" | "connectGameflowEvents" | "close">;

type IntervalHandle = ReturnType<typeof setInterval>;
type SnapshotListener = (snapshot: ServiceSnapshot) => void;

const ATTEMPT_JOIN_QUEUE_RETRY_MS = 5 * 60 * 1000;
const RECONNECT_LOBBY_FALLBACK_MS = 15 * 1000;
const GAME_ENTRY_TIMEOUT_MS = 3 * 60 * 1000;
const GAME_ENTRY_RETRY_DELAY_MS = 2 * 60 * 1000;
const LEAGUE_CLIENT_RESTART_BOOT_MS = 30 * 1000;
const LEAGUE_CLIENT_RESTART_RETRY_MS = 10 * 1000;
const LEAGUE_CLIENT_RESTART_MAX_ATTEMPTS = 12;

export type AutoQueueServiceDependencies = {
  configStore?: AppConfigStore;
  discoverCredentials?: () => LcuCredentials;
  createLcuClient?: (credentials: LcuCredentials) => LcuClientLike;
  logger?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  randomBetween?: (min: number, max: number) => number;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  dismissCrashDialog?: () => Promise<"dismissed" | "closed" | "not_found" | "not_match" | "error">;
  restartLeagueClient?: () => Promise<boolean>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof AxiosError && err.response?.status === status;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/['"`]/g, "").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
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

  return raw.includes("\u53d1\u6761\u9e1f\u7684\u8bd5\u70bc") || normalized.includes("tockerstrials");
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

function hasTextMatch(input: string, patterns: string[]): boolean {
  const raw = input.toLowerCase();
  const normalized = normalizeText(input);

  return patterns.some((pattern) => raw.includes(pattern.toLowerCase()) || normalized.includes(normalizeText(pattern)));
}

function isConnectionLostText(input: string): boolean {
  return hasTextMatch(input, [
    "connection lost",
    "unable to connect to server",
    "unable to connect to the server",
    "cannot connect to server",
    "cannot connect to the server",
    "disconnected from server",
    "\u8fde\u63a5\u65ad\u5f00",
    "\u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668",
    "\u65e0\u6cd5\u8fde\u63a5\u5230\u670d\u52a1\u5668",
    "\u4e0e\u670d\u52a1\u5668\u7684\u8fde\u63a5\u5df2\u65ad\u5f00"
  ]);
}

export function isQueueLimitedError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "\u65e0\u6cd5\u8fdb\u5165\u5339\u914d\u961f\u5217",
    "\u8bf7\u7a0d\u540e\u518d\u8bd5",
    "unable to enter matchmaking queue",
    "please try again later"
  ]);
}

export function isAttemptToJoinQueueFailedError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "attempt to join queue failed",
    "an unexpected error has occurred while attempting to join the queue",
    "unexpected error has occurred while attempting to join the queue",
    "\u52a0\u5165\u961f\u5217\u5931\u8d25",
    "\u5c1d\u8bd5\u52a0\u5165\u961f\u5217\u65f6\u53d1\u751f\u610f\u5916\u9519\u8bef"
  ]);
}

export function isPlayersNotReadyError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "players are not ready",
    "\u73a9\u5bb6\u5c1a\u672a\u5b8c\u6210\u51c6\u5907",
    "player has not finished ready"
  ]);
}

export class AutoQueueService {
  private lcu: LcuClientLike | null = null;
  private enabled = false;
  private handlingObservation = false;
  private pendingObservation: PhaseObservation | null = null;
  private reconnecting = false;
  private restartingClient = false;
  private consecutiveTickFailures = 0;
  private phaseMonitor: PhaseMonitor | null = null;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly configStore: AppConfigStore;
  private readonly defaults = createDefaultAppConfig();
  private readonly stateMachine = new QueueStateMachine();
  private settings: AppSettings;
  private session: QueueSessionState;
  private activeQueueId = 1220;
  private activeQueueName = "Tocker's Trials";

  private readonly discoverCredentials: () => LcuCredentials;
  private readonly createLcuClient: (credentials: LcuCredentials) => LcuClientLike;
  private readonly logger: (message: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly randomBetween: (min: number, max: number) => number;
  private readonly setIntervalFn: (callback: () => void, delay: number) => IntervalHandle;
  private readonly clearIntervalFn: (handle: IntervalHandle) => void;
  private readonly dismissCrashDialog: () => Promise<"dismissed" | "closed" | "not_found" | "not_match" | "error">;
  private readonly restartLeagueClient: () => Promise<boolean>;

  constructor(dependencies: AutoQueueServiceDependencies = {}) {
    this.configStore = dependencies.configStore ?? new MemoryConfigStore(this.defaults);
    const persisted = this.configStore.get();

    this.settings = { ...persisted.settings };
    this.session = new QueueSessionState(persisted.stats);

    this.discoverCredentials = dependencies.discoverCredentials ?? discoverLcuCredentials;
    this.createLcuClient = dependencies.createLcuClient ?? ((credentials) => new RiotLcuClient(credentials));
    this.logger = dependencies.logger ?? log;
    this.sleep = dependencies.sleep ?? sleep;
    this.now = dependencies.now ?? (() => Date.now());
    this.randomBetween = dependencies.randomBetween ?? randomBetween;
    this.setIntervalFn = dependencies.setIntervalFn ?? setInterval;
    this.clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;
    this.dismissCrashDialog =
      dependencies.dismissCrashDialog ?? (() => new SystemErrorRecovery().dismissLeagueCrashDialog());
    this.restartLeagueClient = dependencies.restartLeagueClient ?? (() => new LeagueClientController().restartLeagueClient());
    this.syncActiveQueuePreview();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const nextConfig = this.configStore.update((current) =>
      normalizeAppConfig(
        {
          ...current,
          settings: {
            ...current.settings,
            ...patch
          }
        },
        this.defaults
      )
    );

    this.settings = { ...nextConfig.settings };
    this.syncActiveQueuePreview();
    this.phaseMonitor?.setPollInterval(this.settings.pollIntervalMs);
    this.emitSnapshot();
    return this.getSettings();
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ServiceSnapshot {
    return {
      enabled: this.enabled,
      queueId: this.activeQueueId,
      queueName: this.activeQueueName,
      phase: this.session.phase ?? "Unknown",
      totalCycleCount: this.session.totalCycleCount,
      sessionCycleCount: this.session.sessionCycleCount
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

    this.restoreConfig();
    this.session.resetForStart();
    this.session.markLeagueClientRestart(this.now());
    this.enabled = true;
    this.persistStats();

    await this.initializeLcuAndQueue();
    this.bindPhaseMonitor();

    this.logger(`Enabled for queue: ${this.activeQueueName}`);
    this.emitSnapshot();
    await this.tickOnce();
  }

  async stop(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.phaseMonitor?.stop();
    this.phaseMonitor = null;

    if (this.settings.autoCancelOnDisable && this.lcu) {
      try {
        await this.lcu.delete("/lol-lobby/v2/lobby/matchmaking/search");
      } catch {
        // ignore
      }
    }

    this.lcu?.close();
    this.lcu = null;
    this.handlingObservation = false;
    this.pendingObservation = null;
    this.reconnecting = false;
    this.restartingClient = false;
    this.consecutiveTickFailures = 0;
    this.session.resetForStop();
    this.syncActiveQueuePreview();
    this.persistStats();
    this.emitSnapshot();
    this.logger("Disabled.");
  }

  async tickOnce(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.phaseMonitor?.tickOnce();
  }

  private restoreConfig(): void {
    const persisted = this.configStore.get();
    this.settings = { ...persisted.settings };
    this.session.restoreStats(persisted.stats);
    this.syncActiveQueuePreview();
  }

  private syncActiveQueuePreview(): void {
    if (this.enabled || this.lcu) {
      return;
    }

    if (this.settings.queueId !== null) {
      this.activeQueueId = this.settings.queueId;
      this.activeQueueName = "Manual Queue";
      return;
    }

    this.activeQueueId = 1220;
    this.activeQueueName = "Tocker's Trials";
  }

  private persistStats(): void {
    const stats = this.session.getStats();
    this.configStore.update((current) => ({
      ...current,
      settings: { ...this.settings },
      stats
    }));
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private bindPhaseMonitor(): void {
    if (!this.lcu) {
      return;
    }

    this.phaseMonitor?.stop();
    this.phaseMonitor = new PhaseMonitor({
      client: this.lcu,
      pollIntervalMs: this.settings.pollIntervalMs,
      onPhase: (observation) => this.handleObservedPhase(observation),
      onPollError: (error) => this.handlePhaseReadError(error),
      setIntervalFn: this.setIntervalFn,
      clearIntervalFn: this.clearIntervalFn
    });
    this.phaseMonitor.start();
  }

  private async handleObservedPhase(observation: PhaseObservation): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.handlingObservation) {
      this.pendingObservation = observation;
      return;
    }

    this.handlingObservation = true;
    let nextObservation: PhaseObservation | null = observation;

    try {
      while (nextObservation) {
        this.pendingObservation = null;
        await this.processObservedPhase(nextObservation.phase);
        nextObservation = this.pendingObservation;
      }
    } finally {
      this.handlingObservation = false;
    }
  }

  private async processObservedPhase(phase: GameflowPhase): Promise<void> {
    if (!this.enabled || !this.lcu) {
      return;
    }

    this.consecutiveTickFailures = 0;
    const transition = this.session.observePhase(phase, this.now());

    if (transition.phaseChanged) {
      this.logger(`Phase: ${phase}`);
      this.emitSnapshot();
    }

    if (transition.cycleCompleted) {
      this.persistStats();
      this.logger(`Cycle completed. Session=${this.session.sessionCycleCount}, Total=${this.session.totalCycleCount}`);
      this.emitSnapshot();
    }

    if (phase !== "InProgress" && this.session.shouldReturnToLobbyForGameEntryTimeout(this.now(), GAME_ENTRY_TIMEOUT_MS)) {
      await this.returnToLobbyWithDelay(
        "No game entered for over 3 minutes. Returning to lobby and waiting 2 minutes before retrying.",
        GAME_ENTRY_RETRY_DELAY_MS
      );
      return;
    }

    if (await this.maybeRestartLeagueClient(phase)) {
      return;
    }

    await this.stateMachine.handle(phase, this.createFlowContext());
  }

  private async handlePhaseReadError(error: unknown): Promise<void> {
    this.consecutiveTickFailures += 1;
    this.logger(`Phase read failed: ${String(error)}`);
    if (this.consecutiveTickFailures >= 2) {
      await this.tryRecoverLcuConnection();
    }
  }

  private createFlowContext(): QueueFlowContext {
    return {
      settings: this.settings,
      session: this.session,
      ensureLobbyAndSearch: () => this.ensureLobbyAndSearch(),
      ensureSearch: () => this.ensureSearch(),
      acceptReadyCheck: () => this.acceptReadyCheck(),
      handlePostGame: () => this.handlePostGamePhase(),
      handleGameEntryPhase: (phase) => this.handleGameEntryPhase(phase),
      handleReconnectPhase: () => this.handleReconnectPhase(),
      tryReconnectRecovery: (reason, options) => this.tryReconnectRecovery(reason, options),
      shouldReconnectForTimeout: () =>
        this.session.shouldReconnectForTimeout(this.now(), this.settings.cycleReconnectTimeoutMs)
    };
  }

  private async ensureLobbyAndSearch(): Promise<void> {
    await this.ensureLobby();
    await this.sleep(300);

    if (!this.enabled || !this.lcu) {
      return;
    }

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
    this.logger("Lobby created.");
  }

  private async ensureSearch(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (this.session.isSearchBlocked(now)) {
      if (this.session.shouldLogBlockedSearch(now, 15000)) {
        const leftSec = Math.ceil(this.session.getSearchBlockRemainingMs(now) / 1000);
        this.logger(`Queue retry blocked, waiting ${leftSec}s.`);
        this.session.markBlockedSearchLog(now);
      }
      return;
    }

    if (this.session.consumePendingPostGameSearchDelay()) {
      const delayMs = this.randomBetween(this.settings.postGameDelayMinMs, this.settings.postGameDelayMaxMs);
      this.logger(`Post-game requeue delay: ${delayMs}ms.`);
      await this.sleep(delayMs);

      if (!this.enabled || !this.lcu) {
        return;
      }
    }

    try {
      await this.lcu.post("/lol-lobby/v2/lobby/matchmaking/search");
      this.logger("Search started.");
    } catch (err) {
      if (isPlayersNotReadyError(err)) {
        this.logger("Players are not ready. Leaving current lobby and retrying.");
        await this.recoverToHomeAndRetry();
        return;
      }

      if (isAttemptToJoinQueueFailedError(err)) {
        this.session.blockSearch(this.now(), ATTEMPT_JOIN_QUEUE_RETRY_MS);
        this.logger("Join queue failed unexpectedly. Retry after 5 minutes.");
        return;
      }

      if (isQueueLimitedError(err)) {
        this.session.blockSearch(this.now(), this.settings.queueRetryBlockMs);
        this.logger("Queue limited by server. Retry after 3 minutes.");
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

    const now = this.now();
    if (!this.session.canResetHome(now, this.settings.homeResetCooldownMs)) {
      return;
    }
    this.session.markHomeReset(now);

    try {
      await this.lcu.delete("/lol-lobby/v2/lobby");
      this.logger("Current lobby closed.");
    } catch {
      // ignore if lobby already disappeared
    }

    await this.sleep(1200);
    if (!this.enabled || !this.lcu) {
      return;
    }

    await this.ensureLobbyAndSearch();
  }

  private async acceptReadyCheck(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    try {
      await this.lcu.post("/lol-matchmaking/v1/ready-check/accept");
      this.logger("Ready-check accepted.");
    } catch (err) {
      if (isHttpStatus(err, 404)) {
        return;
      }
      throw err;
    }
  }

  private async handleGameEntryPhase(phase: GameflowPhase): Promise<void> {
    if (phase === "ReadyCheck") {
      await this.acceptReadyCheck();
    }
  }

  private async handleReconnectPhase(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    if (await this.hasConnectionLostSignal()) {
      await this.returnToLobbyAndRetry("Server connection lost. Returning to lobby and restarting queue.");
      return;
    }

    if (this.session.shouldReturnToLobbyFromReconnect(this.now(), RECONNECT_LOBBY_FALLBACK_MS)) {
      await this.returnToLobbyAndRetry("Reconnect phase stayed too long. Returning to lobby and restarting queue.");
      return;
    }

    await this.tryReconnectRecovery("Reconnect state detected. Attempting automatic recovery.");
  }

  private async handlePostGamePhase(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canRunPostGameAction(now, 2000)) {
      return;
    }
    this.session.markPostGameAction(now);

    const playAgain = await this.tryPost("/lol-lobby/v2/play-again");
    if (playAgain) {
      this.logger("Post-game: play-again sent.");
      return;
    }

    const dismiss = await this.tryPost("/lol-end-of-game/v1/state/dismiss-stats");
    if (dismiss) {
      this.logger("Post-game: dismiss-stats sent.");
    }
  }

  private async tryReconnectRecovery(
    reason: string,
    options: {
      resetCycleTimer?: boolean;
    } = {}
  ): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canReconnect(now, this.settings.reconnectCooldownMs)) {
      return;
    }

    this.session.markReconnect(now, options);
    this.logger(reason);
    await this.tryDismissCrashDialog();
    await this.tryReconnectGameSession();
  }

  private async tryReconnectGameSession(): Promise<void> {
    if (!this.lcu) {
      return;
    }

    try {
      await this.lcu.post("/lol-gameflow/v1/reconnect");
      this.logger("Reconnect command sent.");
    } catch (err) {
      if (isConnectionLostText(extractErrorText(err))) {
        await this.returnToLobbyAndRetry("Reconnect failed because the client cannot reach the server. Returning to lobby.");
        return;
      }

      if (isHttpStatus(err, 400) || isHttpStatus(err, 404) || isHttpStatus(err, 409) || isHttpStatus(err, 422)) {
        return;
      }
      this.logger(`Reconnect request failed: ${String(err)}`);
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
      this.logger(`Request failed ${path}: ${String(err)}`);
      return false;
    }
  }

  private async maybeRestartLeagueClient(phase: GameflowPhase): Promise<boolean> {
    if (!this.enabled || this.restartingClient || this.settings.scheduledRestartHours <= 0) {
      return false;
    }

    if (!this.isSafePhaseForScheduledRestart(phase)) {
      return false;
    }

    const intervalMs = this.settings.scheduledRestartHours * 60 * 60 * 1000;
    if (!this.session.shouldRestartLeagueClient(this.now(), intervalMs)) {
      return false;
    }

    await this.restartLeagueClientAndRecover("Scheduled League client restart triggered.");
    return true;
  }

  private async resolveQueue(): Promise<{ id: number; name: string }> {
    if (this.settings.queueId !== null && Number.isFinite(this.settings.queueId)) {
      return { id: this.settings.queueId, name: "Manual Queue" };
    }

    if (!this.lcu) {
      return { id: 1220, name: "Tocker's Trials" };
    }

    const queues = await this.lcu.get<GameQueue[]>("/lol-game-queues/v1/queues");
    const found = queues.find((queue) => isTockersTrialsQueue(queue));
    if (!found) {
      throw new Error("Tocker's Trials queue not found.");
    }

    return { id: found.id, name: found.name ?? found.shortName ?? "Tocker's Trials" };
  }

  private async initializeLcuAndQueue(): Promise<void> {
    const credentials = this.discoverCredentials();
    this.lcu = this.createLcuClient(credentials);

    const queue = await this.resolveQueue();
    this.activeQueueId = queue.id;
    this.activeQueueName = queue.name;
    this.emitSnapshot();
  }

  private async tryRecoverLcuConnection(): Promise<void> {
    if (!this.enabled || this.reconnecting || this.restartingClient) {
      return;
    }

    const now = this.now();
    if (!this.session.canReconnect(now, this.settings.reconnectCooldownMs)) {
      return;
    }

    this.session.markReconnect(now);
    this.reconnecting = true;

    try {
      this.logger("LCU connection unstable, trying recovery...");
      await this.tryDismissCrashDialog();
      this.phaseMonitor?.stop();
      this.phaseMonitor = null;
      this.lcu?.close();
      await this.initializeLcuAndQueue();
      this.bindPhaseMonitor();
      await this.tryReconnectGameSession();
      this.consecutiveTickFailures = 0;
      this.logger("LCU connection recovered.");
    } catch (err) {
      this.logger(`LCU recovery failed: ${String(err)}`);
    } finally {
      this.reconnecting = false;
    }
  }

  private async tryDismissCrashDialog(): Promise<void> {
    const result = await this.dismissCrashDialog();
    if (result === "dismissed" || result === "closed") {
      this.logger("Detected League crash dialog. Dismissed it before reconnecting.");
      await this.sleep(300);
    }
  }

  private async hasConnectionLostSignal(): Promise<boolean> {
    if (!this.lcu) {
      return false;
    }

    const apiPaths = [
      "/lol-game-session/v1/reconnectInfo",
      "/lol-gameflow/v1/session",
      "/lol-lobby/v2/notifications",
      "/lol-gameflow/v1/availability"
    ];

    for (const path of apiPaths) {
      try {
        const payload = await this.lcu.get<unknown>(path);
        if (isConnectionLostText(typeof payload === "string" ? payload : JSON.stringify(payload))) {
          return true;
        }
      } catch {
        // ignore unsupported or unavailable endpoints
      }
    }

    return false;
  }

  private async returnToLobbyAndRetry(reason: string): Promise<void> {
    await this.returnToLobbyWithDelay(reason, 0);
  }

  private async returnToLobbyWithDelay(reason: string, retryDelayMs: number): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canResetHome(now, this.settings.homeResetCooldownMs)) {
      return;
    }

    this.session.markHomeReset(now);
    this.session.resetNoGameTimer(now);
    this.logger(reason);
    if (retryDelayMs > 0) {
      this.session.blockSearch(now, retryDelayMs);
    }

    await this.tryPost("/lol-gameflow/v1/ack-failed-to-launch");
    const requestedLobby = await this.tryPost("/lol-gameflow/v1/session/request-lobby");
    if (requestedLobby) {
      this.logger("Requested return to lobby.");
    }

    await this.sleep(1200);
    if (!this.enabled || !this.lcu) {
      return;
    }

    await this.ensureLobbyAndSearch();
  }

  private isSafePhaseForScheduledRestart(phase: GameflowPhase): boolean {
    return phase !== "InProgress" && phase !== "ReadyCheck" && phase !== "ChampSelect";
  }

  private async restartLeagueClientAndRecover(reason: string): Promise<void> {
    if (!this.enabled || this.restartingClient) {
      return;
    }

    this.restartingClient = true;
    this.session.markLeagueClientRestart(this.now());
    this.session.resetNoGameTimer(this.now());

    try {
      this.logger(reason);
      this.phaseMonitor?.stop();
      this.phaseMonitor = null;
      this.lcu?.close();
      this.lcu = null;

      const restarted = await this.restartLeagueClient();
      if (!restarted) {
        this.logger("League client restart failed.");
        return;
      }

      this.logger("League client restart command sent.");
      await this.sleep(LEAGUE_CLIENT_RESTART_BOOT_MS);

      const recovered = await this.waitForLeagueClientRecovery();
      if (!recovered) {
        this.logger("League client did not recover in time after restart.");
        return;
      }

      this.logger("League client restarted and recovered.");
      await this.ensureLobbyAndSearch();
    } finally {
      this.restartingClient = false;
    }
  }

  private async waitForLeagueClientRecovery(): Promise<boolean> {
    for (let attempt = 0; attempt < LEAGUE_CLIENT_RESTART_MAX_ATTEMPTS; attempt += 1) {
      if (!this.enabled) {
        return false;
      }

      try {
        await this.initializeLcuAndQueue();
        this.bindPhaseMonitor();
        this.consecutiveTickFailures = 0;
        return true;
      } catch {
        if (attempt === LEAGUE_CLIENT_RESTART_MAX_ATTEMPTS - 1) {
          break;
        }
        await this.sleep(LEAGUE_CLIENT_RESTART_RETRY_MS);
      }
    }

    return false;
  }
}
