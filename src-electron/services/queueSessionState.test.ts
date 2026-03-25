import { describe, expect, it } from "vitest";
import { QueueSessionState } from "./queueSessionState";

describe("QueueSessionState", () => {
  it("tracks cycle completion, pending post-game delay, and timeout reconnect windows", () => {
    const session = new QueueSessionState({
      totalCycleCount: 0,
      sessionCycleCount: 0
    });

    session.resetForStart();
    const inProgress = session.observePhase("InProgress", 1000);
    expect(inProgress.cycleCompleted).toBe(false);
    expect(session.shouldReconnectForTimeout(5900, 5000)).toBe(false);
    expect(session.shouldReconnectForTimeout(6000, 5000)).toBe(true);

    const postGame = session.observePhase("PreEndOfGame", 6500);
    expect(postGame.cycleCompleted).toBe(true);
    expect(session.getStats()).toEqual({
      totalCycleCount: 1,
      sessionCycleCount: 1
    });
    expect(session.consumePendingPostGameSearchDelay()).toBe(true);
    expect(session.consumePendingPostGameSearchDelay()).toBe(false);
  });

  it("applies reconnect and queue block cooldowns through session memory", () => {
    const session = new QueueSessionState({
      totalCycleCount: 0,
      sessionCycleCount: 0
    });

    session.resetForStart();
    session.blockSearch(1000, 3000);
    expect(session.isSearchBlocked(2500)).toBe(true);
    expect(session.isSearchBlocked(4500)).toBe(false);

    expect(session.canReconnect(1000, 5000)).toBe(true);
    session.markReconnect(1000);
    expect(session.canReconnect(4000, 5000)).toBe(false);
    expect(session.canReconnect(7000, 5000)).toBe(true);
  });

  it("tracks reconnect phase duration for lobby fallback", () => {
    const session = new QueueSessionState({
      totalCycleCount: 0,
      sessionCycleCount: 0
    });

    session.resetForStart();
    session.observePhase("Reconnect", 1000);
    expect(session.shouldReturnToLobbyFromReconnect(5000, 10000)).toBe(false);
    expect(session.shouldReturnToLobbyFromReconnect(11000, 10000)).toBe(true);

    session.observePhase("Lobby", 12000);
    expect(session.shouldReturnToLobbyFromReconnect(22000, 10000)).toBe(false);
  });
});
