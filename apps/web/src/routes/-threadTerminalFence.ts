export function isTerminalThreadSessionStatus(status: string): boolean {
  return (
    status === "ready" || status === "interrupted" || status === "stopped" || status === "error"
  );
}

const TERMINAL_FENCE_EMPTY_TURN_HOLD_MS = 1_500;

export function doesSnapshotSatisfyTerminalFence(input: {
  readonly snapshotSequence: number;
  readonly fenceSequence: number;
  readonly sessionStatus: string | null | undefined;
  readonly latestTurn: {
    readonly state: string;
    readonly assistantMessageId: string | null;
  } | null;
  readonly messages: ReadonlyArray<{ readonly id: string }>;
  readonly armedAtMs: number;
  readonly nowMs: number;
}): boolean {
  if (
    input.sessionStatus === null ||
    input.sessionStatus === undefined ||
    !isTerminalThreadSessionStatus(input.sessionStatus)
  ) {
    return false;
  }

  if (input.snapshotSequence < input.fenceSequence) return false;

  const latestTurn = input.latestTurn;
  if (latestTurn === null) {
    return true;
  }
  if (latestTurn.state === "interrupted" || latestTurn.state === "error") {
    return true;
  }

  if (
    latestTurn.assistantMessageId !== null &&
    input.messages.some((message) => message.id === latestTurn.assistantMessageId)
  ) {
    return true;
  }

  // A global projection sequence can advance because another thread was updated while this turn's
  // buffered final is still waiting.
  if (latestTurn.assistantMessageId !== null) return false;
  return input.nowMs - input.armedAtMs >= TERMINAL_FENCE_EMPTY_TURN_HOLD_MS;
}
