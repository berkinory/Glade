import { TargetedChildInterruptTombstone } from "../core/providerRuntimeBinding";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { MAX_TARGETED_CHILD_INTERRUPT_TOMBSTONES } from "../core/providerServiceConfiguration";
import { Effect, Layer, Ref } from "effect";
import { ProviderInterruptions, type InterruptionLease } from "../Services/ProviderInterruptions";
import { ProviderValidationError } from "../core/Errors.ts";
import { toValidationError } from "../core/providerServiceValidation";

export const ProviderInterruptionsLive = Layer.effect(
  ProviderInterruptions,
  Effect.gen(function* () {
    const state = yield* Ref.make({
      tombstones: new Map<string, TargetedChildInterruptTombstone>(),
      fences: new Map<ThreadId, { lease: InterruptionLease; settled: Promise<void> }>(),
    });
    const { tombstones: targetedChildInterruptTombstones, fences: providerInterruptionFences } =
      Ref.getUnsafe(state);
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
    ): Effect.Effect<InterruptionLease | undefined> =>
      Effect.suspend(() => {
        const fence = providerInterruptionFences.get(threadId);
        if (!fence) return Effect.succeed(undefined);
        return Effect.promise(() => fence.settled).pipe(
          Effect.flatMap(() =>
            providerInterruptionFences.get(threadId) === fence
              ? Effect.succeed(fence.lease)
              : waitForCurrentInterruptionFence(threadId),
          ),
        );
      });

    const acquireProviderInterruptionFence = (
      threadId: ThreadId,
    ): Effect.Effect<InterruptionLease, ProviderValidationError> =>
      Effect.suspend(() => {
        const existing = providerInterruptionFences.get(threadId);
        if (!existing) {
          let resolveFence!: () => void;
          let failure: string | null = null;
          const lease: InterruptionLease = {
            get failure() {
              return failure;
            },
            settle: (issue) => {
              if (issue !== undefined) failure = issue;
              else if (providerInterruptionFences.get(threadId)?.lease === lease)
                providerInterruptionFences.delete(threadId);
              resolveFence();
            },
          };
          const fence = {
            lease,
            settled: new Promise<void>((resolve) => {
              resolveFence = resolve;
            }),
          };
          providerInterruptionFences.set(threadId, fence);
          return Effect.succeed(lease);
        }
        return Effect.promise(() => existing.settled).pipe(
          Effect.flatMap(() => {
            if (providerInterruptionFences.get(threadId) !== existing) {
              return acquireProviderInterruptionFence(threadId);
            }
            return Effect.fail(
              toValidationError(
                "ProviderService.interruptTurn",
                existing.lease.failure
                  ? `Cannot interrupt thread '${threadId}' because its previous runtime could not be retired safely: ${existing.lease.failure}`
                  : `Cannot interrupt thread '${threadId}' because its previous interruption did not reconcile safely.`,
              ),
            );
          }),
        );
      });
    return {
      wait: waitForCurrentInterruptionFence,
      acquire: acquireProviderInterruptionFence,
      key: targetedChildInterruptKey,
      remember: rememberTargetedChildInterrupt,
      previous: (key: string) => targetedChildInterruptTombstones.get(key),
      clear: (threadId: ThreadId, expected?: InterruptionLease) => {
        if (expected === undefined || providerInterruptionFences.get(threadId)?.lease === expected)
          providerInterruptionFences.delete(threadId);
      },
    };
  }),
);
