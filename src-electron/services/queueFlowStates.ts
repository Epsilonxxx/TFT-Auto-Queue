import type { AppSettings } from "../config/appConfig";
import type { GameflowPhase } from "../lcu/client";
import type { QueueFlowStateName, QueueSessionState } from "./queueSessionState";

export type QueueFlowContext = {
  settings: AppSettings;
  session: QueueSessionState;
  ensureLobbyAndSearch: () => Promise<void>;
  ensureSearch: () => Promise<void>;
  acceptReadyCheck: () => Promise<void>;
  handlePostGame: () => Promise<void>;
  handleGameEntryPhase: (phase: GameflowPhase) => Promise<void>;
  handleReconnectPhase: () => Promise<void>;
  tryReconnectRecovery: (
    reason: string,
    options?: {
      resetCycleTimer?: boolean;
    }
  ) => Promise<void>;
  shouldReconnectForTimeout: () => boolean;
};

export interface QueueFlowState {
  readonly name: QueueFlowStateName;
  supports(phase: GameflowPhase): boolean;
  handle(phase: GameflowPhase, context: QueueFlowContext): Promise<void>;
}

class IdleQueueState implements QueueFlowState {
  readonly name = "Idle" as const;

  supports(): boolean {
    return true;
  }

  async handle(): Promise<void> {
    // no-op
  }
}

class LobbyQueueState implements QueueFlowState {
  readonly name = "Lobby" as const;

  supports(phase: GameflowPhase): boolean {
    return (
      phase === "None" ||
      phase === "Lobby" ||
      phase === "Matchmaking" ||
      phase === "ReadyCheck" ||
      phase === "ChampSelect"
    );
  }

  async handle(phase: GameflowPhase, context: QueueFlowContext): Promise<void> {
    switch (phase) {
      case "None":
        await context.ensureLobbyAndSearch();
        break;
      case "Lobby":
        await context.ensureSearch();
        break;
      case "ReadyCheck":
        await context.handleGameEntryPhase(phase);
        break;
      case "ChampSelect":
        await context.handleGameEntryPhase(phase);
        break;
      default:
        break;
    }
  }
}

class InGameQueueState implements QueueFlowState {
  readonly name = "InGame" as const;

  supports(phase: GameflowPhase): boolean {
    return phase === "InProgress" || phase === "Reconnect" || phase === "TerminatedInError";
  }

  async handle(phase: GameflowPhase, context: QueueFlowContext): Promise<void> {
    if (phase === "Reconnect") {
      await context.handleReconnectPhase();
      return;
    }

    if (phase === "TerminatedInError") {
      await context.tryReconnectRecovery("Client error state detected. Attempting automatic recovery.");
      return;
    }

    if (context.shouldReconnectForTimeout()) {
      await context.tryReconnectRecovery("Cycle exceeded timeout. Attempting reconnect recovery.", {
        resetCycleTimer: true
      });
    }
  }
}

class PostGameQueueState implements QueueFlowState {
  readonly name = "PostGame" as const;

  supports(phase: GameflowPhase): boolean {
    return phase === "WaitingForStats" || phase === "PreEndOfGame" || phase === "EndOfGame";
  }

  async handle(_phase: GameflowPhase, context: QueueFlowContext): Promise<void> {
    await context.handlePostGame();
  }
}

export class QueueStateMachine {
  private readonly states: QueueFlowState[] = [
    new LobbyQueueState(),
    new InGameQueueState(),
    new PostGameQueueState(),
    new IdleQueueState()
  ];

  resolve(phase: GameflowPhase): QueueFlowState {
    return this.states.find((state) => state.supports(phase)) ?? this.states[this.states.length - 1];
  }

  async handle(phase: GameflowPhase, context: QueueFlowContext): Promise<QueueFlowState> {
    const state = this.resolve(phase);
    context.session.setFlowState(state.name);
    await state.handle(phase, context);
    return state;
  }
}
