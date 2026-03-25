import { describe, expect, it } from "vitest";
import { applyPhaseTransition } from "./phaseState";

describe("applyPhaseTransition", () => {
  it("marks the match as active when entering InProgress", () => {
    const result = applyPhaseTransition(
      {
        lastPhase: "Lobby",
        lastPostGameActionAt: 0,
        inCurrentMatch: false,
        totalCycleCount: 2,
        sessionCycleCount: 1,
        pendingPostGameSearchDelay: false
      },
      "InProgress"
    );

    expect(result.phaseChanged).toBe(true);
    expect(result.nextState.inCurrentMatch).toBe(true);
    expect(result.cycleCompleted).toBe(false);
  });

  it("increments counters once when transitioning from a live match into post-game", () => {
    const result = applyPhaseTransition(
      {
        lastPhase: "InProgress",
        lastPostGameActionAt: 0,
        inCurrentMatch: true,
        totalCycleCount: 5,
        sessionCycleCount: 2,
        pendingPostGameSearchDelay: false
      },
      "PreEndOfGame"
    );

    expect(result.cycleCompleted).toBe(true);
    expect(result.nextState.totalCycleCount).toBe(6);
    expect(result.nextState.sessionCycleCount).toBe(3);
    expect(result.nextState.inCurrentMatch).toBe(false);
    expect(result.nextState.pendingPostGameSearchDelay).toBe(true);
  });

  it("does not double-count repeated post-game phases", () => {
    const result = applyPhaseTransition(
      {
        lastPhase: "PreEndOfGame",
        lastPostGameActionAt: 100,
        inCurrentMatch: false,
        totalCycleCount: 6,
        sessionCycleCount: 3,
        pendingPostGameSearchDelay: true
      },
      "EndOfGame"
    );

    expect(result.cycleCompleted).toBe(false);
    expect(result.nextState.totalCycleCount).toBe(6);
    expect(result.nextState.sessionCycleCount).toBe(3);
  });

  it("resets post-game action timing when returning to a non-post-game phase", () => {
    const result = applyPhaseTransition(
      {
        lastPhase: "EndOfGame",
        lastPostGameActionAt: 2000,
        inCurrentMatch: false,
        totalCycleCount: 6,
        sessionCycleCount: 3,
        pendingPostGameSearchDelay: true
      },
      "Lobby"
    );

    expect(result.nextState.lastPostGameActionAt).toBe(0);
    expect(result.nextState.lastPhase).toBe("Lobby");
  });
});
