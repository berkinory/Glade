import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { newCommandId } from "./utils";

type ThreadCommandDispatcher = Pick<NativeApi["orchestration"], "dispatchCommand">;

export interface OptimisticSettledMutation {
  readonly desiredSettled: boolean;

  readonly commandSequence: number | null;

  readonly observedDifferentState: boolean;
}

export function createOptimisticSettledMutation(input: {
  desiredSettled: boolean;
  serverSettledAtDispatch: boolean;
}): OptimisticSettledMutation {
  return {
    desiredSettled: input.desiredSettled,
    commandSequence: null,
    observedDifferentState: input.serverSettledAtDispatch !== input.desiredSettled,
  };
}

export function recordOptimisticSettledMutationSequence(
  mutation: OptimisticSettledMutation,
  commandSequence: number,
): OptimisticSettledMutation {
  if (mutation.commandSequence === commandSequence) return mutation;
  return { ...mutation, commandSequence };
}

export function reconcileOptimisticSettledMutation(
  mutation: OptimisticSettledMutation,
  serverSettled: boolean,
  projectionSequence: number = 0,
): { acknowledged: boolean; mutation: OptimisticSettledMutation } {
  if (mutation.commandSequence !== null && projectionSequence >= mutation.commandSequence) {
    return { acknowledged: true, mutation };
  }
  if (serverSettled === mutation.desiredSettled) {
    return { acknowledged: mutation.observedDifferentState, mutation };
  }
  if (mutation.observedDifferentState) {
    return { acknowledged: false, mutation };
  }
  return {
    acknowledged: false,
    mutation: { ...mutation, observedDifferentState: true },
  };
}

// The server stamps the authoritative `settledAt` timestamp from the `isSettled` intent, so two
// clients toggling concurrently converge on the last write instead of racing on client clocks.
export async function setThreadSettledFromClient(
  api: ThreadCommandDispatcher,
  threadId: ThreadId,
  isSettled: boolean,
): Promise<number> {
  const result = await api.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    isSettled,
  });
  return result.sequence;
}
