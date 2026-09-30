import {
  spawnOwnedClaudeCodeProcess,
  CLAUDE_DISCOVERY_THREAD_ID,
} from "../claude/adapter/sdkProcessRuntime";
import {
  teardownProviderProcessTree,
  teardownChildProcessTree,
} from "../../platform/supervisedProcessTeardown";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ClaudeProcessOwner,
  type ClaudeAdapterLiveOptions,
} from "../claude/adapter/adapterConfiguration";
import type {
  SpawnOptions as ClaudeSpawnOptions,
  SpawnedProcess as ClaudeSpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect, Layer, Ref } from "effect";
import { ProviderAdapterProcessError } from "../core/Errors.ts";
import { PROVIDER } from "../claude/adapter/sessionTypes";
import { toMessage } from "../claude/adapter/streamErrors";
import {
  ClaudeProcessOwnership,
  type ClaudeProcessOwnershipShape,
} from "../Services/ClaudeProcessOwnership.ts";

export function makeClaudeProcessOwnershipLive(options?: ClaudeAdapterLiveOptions) {
  return Layer.effect(
    ClaudeProcessOwnership,
    Effect.gen(function* () {
      const spawnClaudeProcess = options?.spawnClaudeCodeProcess ?? spawnOwnedClaudeCodeProcess;
      const teardownProcessTree = options?.teardownProcessTree ?? teardownProviderProcessTree;
      const failedStartupProcessOwners = yield* Ref.make(new Map<ThreadId, ClaudeProcessOwner>());
      const failedDiscoveryProcessOwners = yield* Ref.make(new Set<ClaudeProcessOwner>());
      const bindClaudeProcessOwner =
        (owner: ClaudeProcessOwner) =>
        (spawnOptions: ClaudeSpawnOptions): ClaudeSpawnedProcess => {
          const process = spawnClaudeProcess(spawnOptions);
          owner.process = process;
          return process;
        };

      const teardownClaudeProcess = (
        threadId: ThreadId,
        owner: ClaudeProcessOwner,
      ): Effect.Effect<void, ProviderAdapterProcessError> => {
        const process = owner.process;
        if (!process) {
          return Effect.void;
        }
        return Effect.tryPromise({
          try: () => teardownChildProcessTree(process, teardownProcessTree),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId,
              detail: toMessage(cause, "Failed to prove Claude process-tree exit."),
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (owner.process === process) {
                delete owner.process;
              }
            }),
          ),
          Effect.asVoid,
        );
      };

      const teardownFailedStartupProcess = Effect.fnUntraced(function* (
        threadId: ThreadId,
        owner: ClaudeProcessOwner,
      ) {
        yield* teardownClaudeProcess(threadId, owner).pipe(
          Effect.tapError(() =>
            owner.process
              ? Ref.update(failedStartupProcessOwners, (current) =>
                  new Map(current).set(threadId, owner),
                )
              : Effect.void,
          ),
        );
        yield* Ref.update(failedStartupProcessOwners, (current) => {
          if (current.get(threadId) !== owner) return current;
          const next = new Map(current);
          next.delete(threadId);
          return next;
        });
      });

      const teardownFailedDiscoveryProcesses = () =>
        Ref.get(failedDiscoveryProcessOwners).pipe(
          Effect.flatMap((owners) =>
            Effect.forEach(
              owners,
              (owner) =>
                teardownClaudeProcess(CLAUDE_DISCOVERY_THREAD_ID, owner).pipe(
                  Effect.tap(() =>
                    Ref.update(failedDiscoveryProcessOwners, (current) => {
                      const next = new Set(current);
                      next.delete(owner);
                      return next;
                    }),
                  ),
                ),
              { discard: true },
            ),
          ),
        );

      const teardownDiscoveryProcess = (owner: ClaudeProcessOwner) =>
        teardownClaudeProcess(CLAUDE_DISCOVERY_THREAD_ID, owner).pipe(
          Effect.tapError(() =>
            owner.process
              ? Ref.update(failedDiscoveryProcessOwners, (current) => new Set(current).add(owner))
              : Effect.void,
          ),
        );
      return {
        teardownClaudeProcess,
        teardownFailedStartupProcess,
        bindClaudeProcessOwner,
        teardownFailedDiscoveryProcesses,
        teardownDiscoveryProcess,
        failedStartupOwner: (threadId: ThreadId) =>
          Ref.getUnsafe(failedStartupProcessOwners).get(threadId),
        rememberFailedStartupOwner: (threadId: ThreadId, owner: ClaudeProcessOwner) =>
          owner.process
            ? Ref.update(failedStartupProcessOwners, (current) =>
                new Map(current).set(threadId, owner),
              )
            : Effect.void,
        failedStartupOwners: () => [...Ref.getUnsafe(failedStartupProcessOwners)],
      } satisfies ClaudeProcessOwnershipShape;
    }),
  );
}
