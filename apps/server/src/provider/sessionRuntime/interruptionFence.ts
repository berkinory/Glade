import {
  TargetedChildInterruptTombstone,
  ProviderInterruptionFence,
} from "../core/providerRuntimeBinding";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { MAX_TARGETED_CHILD_INTERRUPT_TOMBSTONES } from "../core/providerServiceConfiguration";
import { Effect } from "effect";
import { ProviderValidationError } from "../core/Errors.ts";
import { toValidationError } from "../core/providerServiceValidation";

export function makeProviderInterruptionFence(input: {
  readonly targetedChildInterruptTombstones: Map<string, TargetedChildInterruptTombstone>;
  readonly providerInterruptionFences: Map<ThreadId, ProviderInterruptionFence>;
}) {
  const { targetedChildInterruptTombstones, providerInterruptionFences } = input;
  const targetedChildInterruptKey = (
    threadId: ThreadId,
    turnId: TurnId,
    providerThreadId: string,
  ): string => JSON.stringify([threadId, turnId, providerThreadId]);

  const rememberTargetedChildInterrupt = (
    key: string,
    tombstone: TargetedChildInterruptTombstone,
  ): void => {
    const existing = targetedChildInterruptTombstones.get(key);
    if (existing?.state === "confirmed" && tombstone.state === "uncertain") return;
    targetedChildInterruptTombstones.delete(key);
    targetedChildInterruptTombstones.set(key, tombstone);
    while (targetedChildInterruptTombstones.size > MAX_TARGETED_CHILD_INTERRUPT_TOMBSTONES) {
      const oldest = targetedChildInterruptTombstones.keys().next().value;
      if (oldest === undefined) break;
      targetedChildInterruptTombstones.delete(oldest);
    }
  };

  const waitForCurrentInterruptionFence = (
    threadId: ThreadId,
  ): Effect.Effect<ProviderInterruptionFence | undefined> =>
    Effect.suspend(() => {
      const fence = providerInterruptionFences.get(threadId);
      if (!fence) return Effect.succeed(undefined);
      return Effect.promise(() => fence.settled).pipe(
        Effect.flatMap(() =>
          providerInterruptionFences.get(threadId) === fence
            ? Effect.succeed(fence)
            : waitForCurrentInterruptionFence(threadId),
        ),
      );
    });

  const acquireProviderInterruptionFence = (
    threadId: ThreadId,
  ): Effect.Effect<ProviderInterruptionFence, ProviderValidationError> =>
    Effect.suspend(() => {
      const existing = providerInterruptionFences.get(threadId);
      if (!existing) {
        let resolveFence!: () => void;
        const fence: ProviderInterruptionFence = {
          settled: new Promise<void>((resolve) => {
            resolveFence = resolve;
          }),
          resolve: () => resolveFence(),
          failure: null,
        };
        providerInterruptionFences.set(threadId, fence);
        return Effect.succeed(fence);
      }
      return Effect.promise(() => existing.settled).pipe(
        Effect.flatMap(() => {
          if (providerInterruptionFences.get(threadId) !== existing) {
            return acquireProviderInterruptionFence(threadId);
          }
          return Effect.fail(
            toValidationError(
              "ProviderService.interruptTurn",
              existing.failure
                ? `Cannot interrupt thread '${threadId}' because its previous runtime could not be retired safely: ${existing.failure}`
                : `Cannot interrupt thread '${threadId}' because its previous interruption did not reconcile safely.`,
            ),
          );
        }),
      );
    });
  return {
    waitForCurrentInterruptionFence,
    targetedChildInterruptKey,
    rememberTargetedChildInterrupt,
    acquireProviderInterruptionFence,
  };
}
