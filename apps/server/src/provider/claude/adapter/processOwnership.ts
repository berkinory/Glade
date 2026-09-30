import { spawnOwnedClaudeCodeProcess, CLAUDE_DISCOVERY_THREAD_ID } from "./sdkProcessRuntime";
import {
  teardownProviderProcessTree,
  teardownChildProcessTree,
} from "../../../platform/supervisedProcessTeardown";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ClaudeProcessOwner } from "./adapterConfiguration";
import type {
  SpawnOptions as ClaudeSpawnOptions,
  SpawnedProcess as ClaudeSpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { ProviderAdapterProcessError } from "../../core/Errors.ts";
import { PROVIDER } from "./sessionTypes";
import { toMessage } from "./streamErrors";

export function makeClaudeProcessOwnership(input: {
  readonly spawnClaudeProcess: typeof spawnOwnedClaudeCodeProcess;
  readonly teardownProcessTree: typeof teardownProviderProcessTree;
  readonly failedStartupProcessOwners: Map<ThreadId, ClaudeProcessOwner>;
  readonly failedDiscoveryProcessOwners: Set<ClaudeProcessOwner>;
}) {
  const {
    spawnClaudeProcess,
    teardownProcessTree,
    failedStartupProcessOwners,
    failedDiscoveryProcessOwners,
  } = input;
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
        Effect.sync(() => {
          if (owner.process) failedStartupProcessOwners.set(threadId, owner);
        }),
      ),
    );
    if (failedStartupProcessOwners.get(threadId) === owner) {
      failedStartupProcessOwners.delete(threadId);
    }
  });

  const teardownFailedDiscoveryProcesses = () =>
    Effect.forEach(
      failedDiscoveryProcessOwners,
      (owner) =>
        teardownClaudeProcess(CLAUDE_DISCOVERY_THREAD_ID, owner).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              failedDiscoveryProcessOwners.delete(owner);
            }),
          ),
        ),
      { discard: true },
    );

  const teardownDiscoveryProcess = (owner: ClaudeProcessOwner) =>
    teardownClaudeProcess(CLAUDE_DISCOVERY_THREAD_ID, owner).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (owner.process) {
            failedDiscoveryProcessOwners.add(owner);
          }
        }),
      ),
    );
  return {
    teardownClaudeProcess,
    teardownFailedStartupProcess,
    bindClaudeProcessOwner,
    teardownFailedDiscoveryProcesses,
    teardownDiscoveryProcess,
  };
}
