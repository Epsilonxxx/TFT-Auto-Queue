import type { GameflowPhase } from "../lcu/client";
import { applyPhaseTransition, type PhaseTrackingState, type PhaseTransitionResult } from "./phaseState";

export type QueueFlowStateName = "Idle" | "Lobby" | "InGame" | "PostGame";

function isTrackedCyclePhase(phase: GameflowPhase): boolean {
  return (
    phase === "ReadyCheck" ||
    phase === "ChampSelect" ||
    phase === "InProgress" ||
    phase === "Reconnect" ||
    phase === "TerminatedInError" ||
    phase === "WaitingForStats" ||
    phase === "PreEndOfGame" ||
    phase === "EndOfGame"
  );
}

export class QueueSessionState {
  private tracking: PhaseTrackingState;
  private searchBlockedUntil = 0;
  private lastBlockedLogAt = 0;
  private lastHomeResetAt = Number.NEGATIVE_INFINITY;
  private lastReconnectAt = Number.NEGATIVE_INFINITY;
  private activeCycleStartedAt: number | null = null;
  private currentPhaseStartedAt: number | null = null;
  private reconnectPhaseStartedAt: number | null = null;
  private flowState: QueueFlowStateName = "Idle";

  constructor(initialStats: { totalCycleCount: number; sessionCycleCount: number }) {
    this.tracking = {
      lastPhase: null,
      lastPostGameActionAt: 0,
      inCurrentMatch: false,
      totalCycleCount: initialStats.totalCycleCount,
      sessionCycleCount: initialStats.sessionCycleCount,
      pendingPostGameSearchDelay: false
    };
  }

  get phase(): GameflowPhase | null {
    return this.tracking.lastPhase;
  }

  get totalCycleCount(): number {
    return this.tracking.totalCycleCount;
  }

  get sessionCycleCount(): number {
    return this.tracking.sessionCycleCount;
  }

  get currentFlowState(): QueueFlowStateName {
    return this.flowState;
  }

  get pendingPostGameSearchDelay(): boolean {
    return this.tracking.pendingPostGameSearchDelay;
  }

  getStats(): { totalCycleCount: number; sessionCycleCount: number } {
    return {
      totalCycleCount: this.tracking.totalCycleCount,
      sessionCycleCount: this.tracking.sessionCycleCount
    };
  }

  restoreStats(stats: { totalCycleCount: number; sessionCycleCount: number }): void {
    this.tracking.totalCycleCount = stats.totalCycleCount;
    this.tracking.sessionCycleCount = stats.sessionCycleCount;
  }

  resetForStart(): void {
    this.tracking.lastPhase = null;
    this.tracking.lastPostGameActionAt = 0;
    this.tracking.inCurrentMatch = false;
    this.tracking.pendingPostGameSearchDelay = false;
    this.tracking.sessionCycleCount = 0;
    this.searchBlockedUntil = 0;
    this.lastBlockedLogAt = 0;
    this.lastHomeResetAt = Number.NEGATIVE_INFINITY;
    this.lastReconnectAt = Number.NEGATIVE_INFINITY;
    this.activeCycleStartedAt = null;
    this.currentPhaseStartedAt = null;
    this.reconnectPhaseStartedAt = null;
    this.flowState = "Idle";
  }

  resetForStop(): void {
    this.tracking.lastPhase = null;
    this.tracking.lastPostGameActionAt = 0;
    this.tracking.inCurrentMatch = false;
    this.tracking.pendingPostGameSearchDelay = false;
    this.searchBlockedUntil = 0;
    this.lastBlockedLogAt = 0;
    this.lastHomeResetAt = Number.NEGATIVE_INFINITY;
    this.lastReconnectAt = Number.NEGATIVE_INFINITY;
    this.activeCycleStartedAt = null;
    this.currentPhaseStartedAt = null;
    this.reconnectPhaseStartedAt = null;
    this.flowState = "Idle";
  }

  setFlowState(flowState: QueueFlowStateName): void {
    this.flowState = flowState;
  }

  observePhase(phase: GameflowPhase, now: number): PhaseTransitionResult {
    if (phase !== this.tracking.lastPhase) {
      this.currentPhaseStartedAt = now;
    }

    const transition = applyPhaseTransition(this.tracking, phase);
    this.tracking = transition.nextState;
    this.updateCycleWindow(phase, now);
    this.updateReconnectWindow(phase, now);
    return transition;
  }

  blockSearch(now: number, durationMs: number): void {
    this.searchBlockedUntil = now + durationMs;
    this.lastBlockedLogAt = 0;
  }

  isSearchBlocked(now: number): boolean {
    return now < this.searchBlockedUntil;
  }

  getSearchBlockRemainingMs(now: number): number {
    return Math.max(0, this.searchBlockedUntil - now);
  }

  shouldLogBlockedSearch(now: number, minIntervalMs: number): boolean {
    return now - this.lastBlockedLogAt > minIntervalMs;
  }

  markBlockedSearchLog(now: number): void {
    this.lastBlockedLogAt = now;
  }

  consumePendingPostGameSearchDelay(): boolean {
    if (!this.tracking.pendingPostGameSearchDelay) {
      return false;
    }

    this.tracking.pendingPostGameSearchDelay = false;
    return true;
  }

  canRunPostGameAction(now: number, cooldownMs: number): boolean {
    return now - this.tracking.lastPostGameActionAt >= cooldownMs;
  }

  markPostGameAction(now: number): void {
    this.tracking.lastPostGameActionAt = now;
  }

  canResetHome(now: number, cooldownMs: number): boolean {
    return now - this.lastHomeResetAt >= cooldownMs;
  }

  markHomeReset(now: number): void {
    this.lastHomeResetAt = now;
  }

  canReconnect(now: number, cooldownMs: number): boolean {
    return now - this.lastReconnectAt >= cooldownMs;
  }

  markReconnect(now: number, options: { resetCycleTimer?: boolean } = {}): void {
    this.lastReconnectAt = now;
    if (options.resetCycleTimer) {
      this.activeCycleStartedAt = now;
    }
  }

  shouldReconnectForTimeout(now: number, timeoutMs: number): boolean {
    if (this.activeCycleStartedAt === null) {
      return false;
    }

    return now - this.activeCycleStartedAt >= timeoutMs;
  }

  shouldReturnToLobbyFromReconnect(now: number, thresholdMs: number): boolean {
    if (this.tracking.lastPhase !== "Reconnect" || this.reconnectPhaseStartedAt === null) {
      return false;
    }

    return now - this.reconnectPhaseStartedAt >= thresholdMs;
  }

  private updateCycleWindow(phase: GameflowPhase, now: number): void {
    if (isTrackedCyclePhase(phase)) {
      if (this.activeCycleStartedAt === null) {
        this.activeCycleStartedAt = now;
      }
      return;
    }

    this.activeCycleStartedAt = null;
  }

  private updateReconnectWindow(phase: GameflowPhase, now: number): void {
    if (phase === "Reconnect") {
      if (this.reconnectPhaseStartedAt === null) {
        this.reconnectPhaseStartedAt = this.currentPhaseStartedAt ?? now;
      }
      return;
    }

    this.reconnectPhaseStartedAt = null;
  }
}
