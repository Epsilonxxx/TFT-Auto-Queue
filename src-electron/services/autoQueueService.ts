import { AxiosError } from "axios";
import {
  AppConfigStore,
  MemoryConfigStore,
  createDefaultAppConfig,
  normalizeAppConfig,
  type AppSettings,
} from "../config/appConfig";
import type { GameflowPhase, LcuClient } from "../lcu/client";
import { LcuClient as RiotLcuClient } from "../lcu/client";
import type { LcuCredentials } from "../lcu/discovery";
import { discoverLcuCredentials } from "../lcu/discovery";
import { log } from "../utils/logger";
import {
  LeagueGameRecovery,
  type TerminateGameProcessResult,
} from "../utils/leagueGameRecovery";
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
  lastError: string | null;
  connection: "idle" | "connecting" | "connected" | "reconnecting";
  startedAt: number | null;
  phaseStartedAt: number | null;
  retryAt: number | null;
  matchDeadlineAt: number | null;
  activity: Array<{ id: number; at: number; message: string }>;
};

export type LcuClientLike = Pick<
  LcuClient,
  "get" | "post" | "delete" | "connectGameflowEvents" | "close"
>;

type IntervalHandle = ReturnType<typeof setInterval>;
type SnapshotListener = (snapshot: ServiceSnapshot) => void;

const ATTEMPT_JOIN_QUEUE_RETRY_MS = 3 * 60 * 1000;
const RECONNECT_LOBBY_FALLBACK_MS = 15 * 1000;
const GAME_ENTRY_TIMEOUT_MS = 3 * 60 * 1000;
const GAME_ENTRY_RETRY_DELAY_MS = 2 * 60 * 1000;

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
  dismissCrashDialog?: () => Promise<
    "reported" | "dismissed" | "closed" | "not_found" | "not_match" | "error"
  >;
  terminateGameProcess?: (
    leagueInstallPath?: string | null,
  ) => Promise<TerminateGameProcessResult>;
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
  return input
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
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
    queue.map ?? "",
  ].join(" ");
  const normalized = normalizeText(raw);

  return (
    raw.includes("\u53d1\u6761\u9e1f\u7684\u8bd5\u70bc") ||
    normalized.includes("tockerstrials")
  );
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

function formatErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const text = extractErrorText(err).trim();
    if (text) {
      return text;
    }
  }

  if (err instanceof Error) {
    return err.message || err.name;
  }

  const fallback = String(err ?? "").trim();
  return fallback || "Unknown error";
}

function hasTextMatch(input: string, patterns: string[]): boolean {
  const raw = input.toLowerCase();
  const normalized = normalizeText(input);

  return patterns.some(
    (pattern) =>
      raw.includes(pattern.toLowerCase()) ||
      normalized.includes(normalizeText(pattern)),
  );
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
    "\u4e0e\u670d\u52a1\u5668\u7684\u8fde\u63a5\u5df2\u65ad\u5f00",
  ]);
}

export function isQueueLimitedError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "queue is disabled",
    "queue is unavailable",
    "rate limit",
    "too many requests",
    "\u961f\u5217\u5df2\u7981\u7528",
    "\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41",
  ]);
}

export function isAttemptToJoinQueueFailedError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "attempt to join queue failed",
    "an unexpected error has occurred while attempting to join the queue",
    "unexpected error has occurred while attempting to join the queue",
    "\u52a0\u5165\u961f\u5217\u5931\u8d25",
    "\u5c1d\u8bd5\u52a0\u5165\u961f\u5217\u65f6\u53d1\u751f\u610f\u5916\u9519\u8bef",
  ]);
}

export function isPlayersNotReadyError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "players are not ready",
    "\u73a9\u5bb6\u5c1a\u672a\u5b8c\u6210\u51c6\u5907",
    "player has not finished ready",
  ]);
}

export function isUnableToEnterMatchmakingQueueError(err: unknown): boolean {
  return hasTextMatch(extractErrorText(err), [
    "\u65e0\u6cd5\u8fdb\u5165\u5339\u914d\u961f\u5217",
    "\u65e0\u6cd5\u5f00\u59cb\u5339\u914d",
    "\u65e0\u6cd5\u52a0\u5165\u961f\u5217",
    "unable to enter matchmaking queue",
    "unable to start matchmaking",
    "unable to join the matchmaking queue",
    "failed to start matchmaking",
  ]);
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
}

export class AutoQueueService {
  private lcu: LcuClientLike | null = null;
  private stopClient: LcuClientLike | null = null;
  private enabled = false;
  private lastError: string | null = null;
  private handlingObservation = false;
  private pendingObservation: PhaseObservation | null = null;
  private reconnecting = false;
  private consecutiveTickFailures = 0;
  private consecutiveSearchFailures = 0;
  private generation = 0;
  private connection: ServiceSnapshot["connection"] = "idle";
  private startedAt: number | null = null;
  private activity: ServiceSnapshot["activity"] = [];
  private activityId = 0;
  private stopping: Promise<void> | null = null;
  private runController = new AbortController();
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
  private readonly createLcuClient: (
    credentials: LcuCredentials,
  ) => LcuClientLike;
  private readonly logger: (message: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly randomBetween: (min: number, max: number) => number;
  private readonly setIntervalFn: (
    callback: () => void,
    delay: number,
  ) => IntervalHandle;
  private readonly clearIntervalFn: (handle: IntervalHandle) => void;
  private readonly dismissCrashDialog: () => Promise<
    "reported" | "dismissed" | "closed" | "not_found" | "not_match" | "error"
  >;
  private readonly terminateGameProcess: (
    leagueInstallPath?: string | null,
  ) => Promise<TerminateGameProcessResult>;

  constructor(dependencies: AutoQueueServiceDependencies = {}) {
    this.configStore =
      dependencies.configStore ?? new MemoryConfigStore(this.defaults);
    const persisted = this.configStore.get();

    this.settings = { ...persisted.settings };
    this.session = new QueueSessionState(persisted.stats);

    this.discoverCredentials =
      dependencies.discoverCredentials ?? discoverLcuCredentials;
    this.createLcuClient =
      dependencies.createLcuClient ??
      ((credentials) => new RiotLcuClient(credentials));
    this.logger = (message) => {
      this.activity.push({ id: ++this.activityId, at: this.now(), message });
      if (this.activity.length > 80) this.activity.shift();
      (dependencies.logger ?? log)(message);
      this.emitSnapshot();
    };
    this.sleep = dependencies.sleep ?? sleep;
    this.now = dependencies.now ?? (() => Date.now());
    this.randomBetween = dependencies.randomBetween ?? randomBetween;
    this.setIntervalFn = dependencies.setIntervalFn ?? setInterval;
    this.clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;
    this.dismissCrashDialog =
      dependencies.dismissCrashDialog ??
      (() =>
        new SystemErrorRecovery().dismissLeagueCrashDialog(
          this.runController.signal,
        ));
    this.terminateGameProcess =
      dependencies.terminateGameProcess ??
      ((leagueInstallPath) =>
        new LeagueGameRecovery().terminateLeagueGameProcess(leagueInstallPath));
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
            ...patch,
          },
        },
        this.defaults,
      ),
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
      sessionCycleCount: this.session.sessionCycleCount,
      lastError: this.lastError,
      connection: this.connection,
      startedAt: this.startedAt,
      phaseStartedAt: this.session.phaseStartedAt,
      retryAt: this.session.isSearchBlocked(this.now())
        ? this.now() + this.session.getSearchBlockRemainingMs(this.now())
        : null,
      matchDeadlineAt:
        this.session.matchStartedAt === null
          ? null
          : this.session.matchStartedAt + this.settings.cycleReconnectTimeoutMs,
      activity: this.activity.map((entry) => ({ ...entry })),
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
    if (this.stopping) await this.stopping;
    if (this.enabled) {
      return;
    }

    this.restoreConfig();
    this.session.resetForStart();
    this.enabled = true;
    const generation = ++this.generation;
    this.runController = new AbortController();
    this.connection = "connecting";
    this.startedAt = this.now();
    this.lastError = null;
    this.emitSnapshot();
    try {
      this.persistStats();
      await this.initializeLcuAndQueue();
      if (!this.enabled || generation !== this.generation) return;
      this.bindPhaseMonitor();

      this.logger(`Enabled for queue: ${this.activeQueueName}`);
      this.emitSnapshot();
      await this.tickOnce();
    } catch (error) {
      if (generation !== this.generation) return;
      this.rollbackFailedStart(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.generation += 1;
    this.runController.abort();
    this.connection = "idle";
    this.startedAt = null;
    this.phaseMonitor?.stop();
    this.phaseMonitor = null;

    const client = this.stopClient ?? this.lcu;
    this.stopClient = null;
    this.lcu = null;
    this.stopping = this.finishStop(client);
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
  }

  private async finishStop(client: LcuClientLike | null): Promise<void> {
    if (this.settings.autoCancelOnDisable && client) {
      try {
        await client.delete("/lol-lobby/v2/lobby/matchmaking/search");
      } catch {
        // ignore
      }
    }

    client?.close();
    this.handlingObservation = false;
    this.pendingObservation = null;
    this.reconnecting = false;
    this.consecutiveTickFailures = 0;
    this.consecutiveSearchFailures = 0;
    this.lastError = null;
    this.session.resetForStop();
    this.syncActiveQueuePreview();
    try {
      this.persistStats();
    } catch (error) {
      this.lastError = formatErrorMessage(error);
    }
    this.emitSnapshot();
    this.logger("Disabled.");
  }

  async tickOnce(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.phaseMonitor?.tickOnce();
  }

  private async wait(ms: number): Promise<void> {
    const generation = this.generation;
    await this.sleep(ms);
    if (!this.enabled || generation !== this.generation)
      throw new Error("Operation cancelled.");
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
      stats,
    }));
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private rollbackFailedStart(error: unknown): void {
    this.enabled = false;
    this.connection = "idle";
    this.startedAt = null;
    this.phaseMonitor?.stop();
    this.phaseMonitor = null;
    this.lcu?.close();
    this.lcu = null;
    this.stopClient = null;
    this.handlingObservation = false;
    this.pendingObservation = null;
    this.reconnecting = false;
    this.consecutiveTickFailures = 0;
    this.lastError = formatErrorMessage(error);
    this.session.resetForStop();
    this.syncActiveQueuePreview();
    this.emitSnapshot();
    this.logger(`Enable failed: ${this.lastError}`);
  }

  private bindPhaseMonitor(): void {
    if (!this.lcu) {
      return;
    }

    this.phaseMonitor?.stop();
    const generation = this.generation;
    this.phaseMonitor = new PhaseMonitor({
      client: this.lcu,
      pollIntervalMs: this.settings.pollIntervalMs,
      onPhase: (observation) =>
        generation === this.generation
          ? this.handleObservedPhase(observation)
          : undefined,
      onPollError: (error) =>
        generation === this.generation
          ? this.handlePhaseReadError(error)
          : undefined,
      setIntervalFn: this.setIntervalFn,
      clearIntervalFn: this.clearIntervalFn,
    });
    this.phaseMonitor.start();
  }

  private async handleObservedPhase(
    observation: PhaseObservation,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.handlingObservation) {
      this.pendingObservation = observation;
      return;
    }

    this.handlingObservation = true;
    const generation = this.generation;
    let nextObservation: PhaseObservation | null = observation;

    try {
      while (
        nextObservation &&
        this.enabled &&
        generation === this.generation
      ) {
        this.pendingObservation = null;
        await this.processObservedPhase(nextObservation.phase);
        nextObservation = this.pendingObservation;
      }
    } catch (error) {
      if (this.enabled && generation === this.generation) {
        this.lastError = formatErrorMessage(error);
        this.logger(`Action failed: ${this.lastError}`);
      }
    } finally {
      if (generation === this.generation) this.handlingObservation = false;
    }
  }

  private async processObservedPhase(phase: GameflowPhase): Promise<void> {
    if (!this.enabled || !this.lcu) {
      return;
    }

    this.consecutiveTickFailures = 0;
    if (this.connection === "reconnecting") this.lastError = null;
    this.connection = "connected";
    if (
      phase === "Matchmaking" ||
      phase === "ReadyCheck" ||
      phase === "ChampSelect" ||
      phase === "InProgress"
    ) {
      this.consecutiveSearchFailures = 0;
    }
    const transition = this.session.observePhase(phase, this.now());

    if (transition.phaseChanged) {
      this.logger(`Phase: ${phase}`);
      this.emitSnapshot();
    }

    if (transition.cycleCompleted) {
      this.persistStats();
      this.logger(
        `Cycle completed. Session=${this.session.sessionCycleCount}, Total=${this.session.totalCycleCount}`,
      );
      this.emitSnapshot();
    }

    this.emitSnapshot();
    if (
      this.session.shouldReconnectForTimeout(
        this.now(),
        this.settings.cycleReconnectTimeoutMs,
      )
    ) {
      await this.handleCycleTimeout();
      return;
    }

    if (
      !this.session.isSearchBlocked(this.now()) &&
      this.session.shouldReturnToLobbyForGameEntryTimeout(
        this.now(),
        GAME_ENTRY_TIMEOUT_MS,
      )
    ) {
      await this.returnToHomePageAndWait(
        "No game entered for over 3 minutes. Returning to the League home screen and retrying in 2 minutes.",
        GAME_ENTRY_RETRY_DELAY_MS,
      );
      return;
    }

    await this.stateMachine.handle(phase, this.createFlowContext());
  }

  private async handlePhaseReadError(error: unknown): Promise<void> {
    if (!this.enabled) return;
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
      tryReconnectRecovery: (reason, options) =>
        this.tryReconnectRecovery(reason, options),
      shouldRecoverFromCycleTimeout: () =>
        this.session.shouldReconnectForTimeout(
          this.now(),
          this.settings.cycleReconnectTimeoutMs,
        ),
      handleCycleTimeout: () => this.handleCycleTimeout(),
    };
  }

  private async ensureLobbyAndSearch(): Promise<void> {
    const now = this.now();
    if (this.session.shouldStayOnHome(now)) {
      this.logBlockedSearchWait(
        now,
        "Waiting on the League home screen before retrying queue.",
      );
      return;
    }

    await this.ensureLobby();
    await this.wait(300);

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
      const lobby = await this.lcu.get<Lobby>("/lol-lobby/v2/lobby");
      if (lobby.queueId !== this.activeQueueId) {
        throw new Error(
          "Current lobby uses a different queue. Leave the lobby before starting auto queue.",
        );
      }
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
    if (!this.enabled || !this.lcu) {
      return;
    }

    const generation = this.generation;
    const now = this.now();
    if (this.session.isSearchBlocked(now)) {
      this.logBlockedSearchWait(
        now,
        this.session.shouldStayOnHome(now)
          ? "Waiting on the League home screen before retrying queue."
          : "Queue retry blocked.",
      );
      return;
    }

    if (this.session.consumePendingPostGameSearchDelay()) {
      const delayMs = this.randomBetween(
        this.settings.postGameDelayMinMs,
        this.settings.postGameDelayMaxMs,
      );
      this.logger(
        `Post-game requeue delay: ${(delayMs / 1000).toFixed(delayMs % 1000 === 0 ? 0 : 1)}s.`,
      );
      await this.wait(delayMs);

      if (!this.enabled || !this.lcu) {
        return;
      }
    }

    try {
      const phase = await this.lcu.get<GameflowPhase>(
        "/lol-gameflow/v1/gameflow-phase",
      );
      if (phase !== "None" && phase !== "Lobby") return;
      await this.ensureLobby();
      await this.lcu.post("/lol-lobby/v2/lobby/matchmaking/search");
      this.consecutiveSearchFailures = 0;
      this.lastError = null;
      this.logger("Search started.");
    } catch (err) {
      if (!this.enabled || generation !== this.generation) return;
      if (isPlayersNotReadyError(err)) {
        this.consecutiveSearchFailures = 0;
        this.logger(
          "Players are not ready. Leaving current lobby and retrying.",
        );
        await this.recoverToHomeAndRetry();
        return;
      }

      if (isAttemptToJoinQueueFailedError(err)) {
        this.consecutiveSearchFailures = 0;
        await this.returnToHomePageAndWait(
          "Attempt to join queue failed. Returning to the League home screen and retrying in 3 minutes.",
          ATTEMPT_JOIN_QUEUE_RETRY_MS,
        );
        return;
      }

      if (isHttpStatus(err, 429) || isQueueLimitedError(err)) {
        this.consecutiveSearchFailures = 0;
        this.session.blockSearch(this.now(), this.settings.queueRetryBlockMs);
        this.logger(
          `Queue limited by server. Retry after ${formatDurationMs(this.settings.queueRetryBlockMs)}.`,
        );
        return;
      }

      if (isUnableToEnterMatchmakingQueueError(err)) {
        await this.handleSearchStartFailure(
          err,
          "Unable to enter matchmaking queue. Returning to the League home screen and retrying in 3 minutes.",
        );
        return;
      }

      await this.handleSearchStartFailure(err);
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
    this.consecutiveSearchFailures = 0;

    try {
      await this.lcu.delete("/lol-lobby/v2/lobby");
      this.logger("Current lobby closed.");
    } catch {
      // ignore if lobby already disappeared
    }

    await this.wait(1200);
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
      await this.returnToLobbyAndRetry(
        "Server connection lost. Returning to lobby and restarting queue.",
      );
      return;
    }

    if (
      this.session.shouldReturnToLobbyFromReconnect(
        this.now(),
        RECONNECT_LOBBY_FALLBACK_MS,
      )
    ) {
      await this.returnToLobbyAndRetry(
        "Reconnect phase stayed too long. Returning to lobby and restarting queue.",
      );
      return;
    }

    await this.tryReconnectRecovery(
      "Reconnect state detected. Attempting automatic recovery.",
    );
  }

  private async handleCycleTimeout(): Promise<void> {
    const timeoutText = formatDurationMs(this.settings.cycleReconnectTimeoutMs);
    await this.forceQuitGameAndRecover(
      `Same match exceeded ${timeoutText}. Force-closing the game and restarting queue.`,
    );
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

    const dismiss = await this.tryPost(
      "/lol-end-of-game/v1/state/dismiss-stats",
    );
    if (dismiss) {
      this.logger("Post-game: dismiss-stats sent.");
    }
  }

  private async tryReconnectRecovery(
    reason: string,
    options: {
      resetCycleTimer?: boolean;
    } = {},
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

  private async handleSearchStartFailure(
    error: unknown,
    forcedReason?: string,
  ): Promise<void> {
    this.consecutiveSearchFailures += 1;
    const errorText = formatErrorMessage(error);

    if (forcedReason || this.consecutiveSearchFailures >= 3) {
      this.consecutiveSearchFailures = 0;
      await this.returnToHomePageAndWait(
        forcedReason ??
          `Repeated matchmaking start failures detected (${errorText}). Returning to the League home screen and retrying in 3 minutes.`,
        ATTEMPT_JOIN_QUEUE_RETRY_MS,
      );
      return;
    }

    this.logger(
      `Matchmaking start failed (${this.consecutiveSearchFailures}/3): ${errorText}`,
    );
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
        await this.returnToLobbyAndRetry(
          "Reconnect failed because the client cannot reach the server. Returning to lobby.",
        );
        return;
      }

      if (
        isHttpStatus(err, 400) ||
        isHttpStatus(err, 404) ||
        isHttpStatus(err, 409) ||
        isHttpStatus(err, 422)
      ) {
        return;
      }
      this.logger(`Reconnect request failed: ${String(err)}`);
    }
  }

  private async tryPost(path: string): Promise<boolean> {
    if (!this.enabled || !this.lcu) {
      return false;
    }

    try {
      await this.lcu.post(path);
      return true;
    } catch (err) {
      if (
        isHttpStatus(err, 400) ||
        isHttpStatus(err, 404) ||
        isHttpStatus(err, 409) ||
        isHttpStatus(err, 422)
      ) {
        return false;
      }
      this.logger(`Request failed ${path}: ${String(err)}`);
      return false;
    }
  }

  private async tryDelete(path: string): Promise<boolean> {
    if (!this.enabled || !this.lcu) {
      return false;
    }

    try {
      await this.lcu.delete(path);
      return true;
    } catch (err) {
      if (
        isHttpStatus(err, 400) ||
        isHttpStatus(err, 404) ||
        isHttpStatus(err, 409) ||
        isHttpStatus(err, 422)
      ) {
        return false;
      }
      this.logger(`Request failed ${path}: ${String(err)}`);
      return false;
    }
  }

  private async resolveQueue(
    client = this.lcu,
  ): Promise<{ id: number; name: string }> {
    if (
      this.settings.queueId !== null &&
      Number.isFinite(this.settings.queueId)
    ) {
      return { id: this.settings.queueId, name: "Manual Queue" };
    }

    if (!client) {
      return { id: 1220, name: "Tocker's Trials" };
    }

    const queues = await client.get<GameQueue[]>("/lol-game-queues/v1/queues");
    const found = queues.find((queue) => isTockersTrialsQueue(queue));
    if (!found) {
      throw new Error("Tocker's Trials queue not found.");
    }

    return {
      id: found.id,
      name: found.name ?? found.shortName ?? "Tocker's Trials",
    };
  }

  private async initializeLcuAndQueue(): Promise<void> {
    const generation = this.generation;
    const credentials = this.discoverCredentials();
    const candidate = this.createLcuClient(credentials);
    let queue: { id: number; name: string };
    try {
      queue = await this.resolveQueue(candidate);
    } catch (error) {
      candidate.close();
      throw error;
    }
    if (!this.enabled || generation !== this.generation) {
      candidate.close();
      return;
    }
    this.lcu?.close();
    this.stopClient = candidate;
    const checkActive = () => {
      if (!this.enabled || generation !== this.generation)
        throw new Error("Operation cancelled.");
    };
    this.lcu = {
      get: async <T>(path: string) => {
        checkActive();
        const result = await candidate.get<T>(path);
        checkActive();
        return result;
      },
      post: async <T>(path: string, body?: unknown) => {
        checkActive();
        const result = await candidate.post<T>(path, body);
        checkActive();
        return result;
      },
      delete: async <T>(path: string) => {
        checkActive();
        const result = await candidate.delete<T>(path);
        checkActive();
        return result;
      },
      connectGameflowEvents: (listener) =>
        candidate.connectGameflowEvents(listener),
      close: () => candidate.close(),
    };
    this.connection = "connected";
    this.activeQueueId = queue.id;
    this.activeQueueName = queue.name;
    this.emitSnapshot();
  }

  private async tryRecoverLcuConnection(): Promise<void> {
    if (!this.enabled || this.reconnecting) {
      return;
    }

    const now = this.now();
    if (!this.session.canReconnect(now, this.settings.reconnectCooldownMs)) {
      return;
    }

    this.session.markReconnect(now);
    this.reconnecting = true;
    const generation = this.generation;
    this.connection = "reconnecting";

    try {
      this.logger("LCU connection unstable, trying recovery...");
      await this.tryDismissCrashDialog();
      if (!this.enabled || generation !== this.generation) return;
      await this.initializeLcuAndQueue();
      if (!this.enabled || generation !== this.generation) return;
      this.bindPhaseMonitor();
      this.consecutiveTickFailures = 0;
      this.logger("LCU connection recovered.");
    } catch (err) {
      if (!this.enabled || generation !== this.generation) return;
      this.lastError = formatErrorMessage(err);
      this.logger(`LCU recovery failed: ${String(err)}`);
    } finally {
      if (generation === this.generation) {
        this.reconnecting = false;
        this.emitSnapshot();
      }
    }
  }

  private async tryDismissCrashDialog(): Promise<void> {
    const result = await this.dismissCrashDialog();
    if (result === "reported") {
      this.logger(
        "Detected a League crash dialog and completed the crash-report flow.",
      );
      await this.wait(300);
      return;
    }

    if (result === "dismissed" || result === "closed") {
      this.logger("Detected a League crash dialog and handled it.");
      await this.wait(300);
    }
  }

  private async forceQuitGameAndRecover(reason: string): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canResetHome(now, this.settings.homeResetCooldownMs)) {
      return;
    }

    this.session.markHomeReset(now);
    this.session.markReconnect(now, { resetCycleTimer: true });
    this.session.resetNoGameTimer(now);
    this.consecutiveSearchFailures = 0;
    this.logger(reason);

    const terminateResult = await this.terminateGameProcess();
    if (terminateResult === "terminated") {
      this.logger("Force-closed the League game process.");
    } else if (terminateResult === "not_found") {
      this.logger(
        "No active League game process was found. Continuing recovery.",
      );
    } else {
      this.logger(
        "Failed to force-close the League game process. Continuing recovery.",
      );
    }

    await this.wait(3000);
    if (!this.enabled || !this.lcu) return;
    await this.tryDismissCrashDialog();
    if (!this.enabled || !this.lcu) return;
    await this.tryPost("/lol-gameflow/v1/ack-failed-to-launch");
    const requestedLobby = await this.tryPost(
      "/lol-gameflow/v1/session/request-lobby",
    );
    if (requestedLobby) {
      this.logger("Requested return to lobby after force-closing the game.");
    }

    await this.wait(1200);
    if (!this.enabled || !this.lcu) {
      return;
    }

    const phase = await this.lcu.get<GameflowPhase>(
      "/lol-gameflow/v1/gameflow-phase",
    );
    if (phase === "None" || phase === "Lobby")
      await this.ensureLobbyAndSearch();
  }

  private async hasConnectionLostSignal(): Promise<boolean> {
    if (!this.lcu) {
      return false;
    }

    const apiPaths = [
      "/lol-game-session/v1/reconnectInfo",
      "/lol-gameflow/v1/session",
      "/lol-lobby/v2/notifications",
      "/lol-gameflow/v1/availability",
    ];

    for (const path of apiPaths) {
      try {
        const payload = await this.lcu.get<unknown>(path);
        if (
          isConnectionLostText(
            typeof payload === "string" ? payload : JSON.stringify(payload),
          )
        ) {
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

  private logBlockedSearchWait(now: number, message: string): void {
    if (!this.session.shouldLogBlockedSearch(now, 15000)) {
      return;
    }

    const leftSec = Math.ceil(
      this.session.getSearchBlockRemainingMs(now) / 1000,
    );
    this.logger(`${message} ${leftSec}s remaining.`);
    this.session.markBlockedSearchLog(now);
  }

  private async returnToHomePageAndWait(
    reason: string,
    retryDelayMs: number,
  ): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canResetHome(now, this.settings.homeResetCooldownMs)) {
      return;
    }

    this.session.markHomeReset(now);
    this.session.resetNoGameTimer(now);
    this.session.blockSearch(now, retryDelayMs, { stayOnHome: true });
    this.consecutiveSearchFailures = 0;
    this.logger(reason);
    await this.tryDismissCrashDialog();

    await this.tryDelete("/lol-lobby/v2/lobby/matchmaking/search");
    const deletedLobby = await this.tryDelete("/lol-lobby/v2/lobby");
    if (deletedLobby) {
      this.logger("Returned to the League home screen.");
    }
  }

  private async returnToLobbyWithDelay(
    reason: string,
    retryDelayMs: number,
  ): Promise<void> {
    if (!this.lcu) {
      return;
    }

    const now = this.now();
    if (!this.session.canResetHome(now, this.settings.homeResetCooldownMs)) {
      return;
    }

    this.session.markHomeReset(now);
    this.session.resetNoGameTimer(now);
    this.consecutiveSearchFailures = 0;
    this.logger(reason);
    if (retryDelayMs > 0) {
      this.session.blockSearch(now, retryDelayMs);
    }

    await this.tryPost("/lol-gameflow/v1/ack-failed-to-launch");
    const requestedLobby = await this.tryPost(
      "/lol-gameflow/v1/session/request-lobby",
    );
    if (requestedLobby) {
      this.logger("Requested return to lobby.");
    }

    await this.wait(1200);
    if (!this.enabled || !this.lcu) {
      return;
    }

    const phase = await this.lcu.get<GameflowPhase>(
      "/lol-gameflow/v1/gameflow-phase",
    );
    if (phase === "None" || phase === "Lobby")
      await this.ensureLobbyAndSearch();
  }
}
