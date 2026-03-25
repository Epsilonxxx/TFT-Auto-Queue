import type { GameflowPhase } from "../lcu/client";

export type PhaseTrackingState = {
  lastPhase: GameflowPhase | null;
  lastPostGameActionAt: number;
  inCurrentMatch: boolean;
  totalCycleCount: number;
  sessionCycleCount: number;
  pendingPostGameSearchDelay: boolean;
};

export type PhaseTransitionResult = {
  nextState: PhaseTrackingState;
  phaseChanged: boolean;
  cycleCompleted: boolean;
};

export function isPostGamePhase(phase: GameflowPhase): boolean {
  return phase === "PreEndOfGame" || phase === "EndOfGame" || phase === "WaitingForStats";
}

export function isMatchActivePhase(phase: GameflowPhase): boolean {
  return phase === "InProgress";
}

export function applyPhaseTransition(
  currentState: PhaseTrackingState,
  phase: GameflowPhase
): PhaseTransitionResult {
  const nextState: PhaseTrackingState = {
    ...currentState,
    lastPhase: phase
  };

  const phaseChanged = phase !== currentState.lastPhase;
  let cycleCompleted = false;

  if (isMatchActivePhase(phase)) {
    nextState.inCurrentMatch = true;
  }

  if (isPostGamePhase(phase)) {
    if (currentState.inCurrentMatch) {
      nextState.inCurrentMatch = false;
      nextState.totalCycleCount += 1;
      nextState.sessionCycleCount += 1;
      nextState.pendingPostGameSearchDelay = true;
      cycleCompleted = true;
    }
  } else {
    nextState.lastPostGameActionAt = 0;
  }

  return {
    nextState,
    phaseChanged,
    cycleCompleted
  };
}
