import type {
  SpawnOptions as ClaudeSpawnOptions,
  SpawnedProcess as ClaudeSpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, ServiceMap } from "effect";
import type { ClaudeProcessOwner } from "../claude/adapter/adapterConfiguration.ts";
import type { ProviderAdapterProcessError } from "../core/Errors.ts";

export interface ClaudeProcessOwnershipShape {
  readonly bindClaudeProcessOwner: (
    owner: ClaudeProcessOwner,
  ) => (options: ClaudeSpawnOptions) => ClaudeSpawnedProcess;
  readonly teardownClaudeProcess: (
    threadId: ThreadId,
    owner: ClaudeProcessOwner,
  ) => Effect.Effect<void, ProviderAdapterProcessError>;
  readonly teardownFailedStartupProcess: (
    threadId: ThreadId,
    owner: ClaudeProcessOwner,
  ) => Effect.Effect<void, ProviderAdapterProcessError>;
  readonly failedStartupOwner: (threadId: ThreadId) => ClaudeProcessOwner | undefined;
  readonly rememberFailedStartupOwner: (
    threadId: ThreadId,
    owner: ClaudeProcessOwner,
  ) => Effect.Effect<void>;
  readonly failedStartupOwners: () => ReadonlyArray<readonly [ThreadId, ClaudeProcessOwner]>;
  readonly teardownFailedDiscoveryProcesses: () => Effect.Effect<void, ProviderAdapterProcessError>;
  readonly teardownDiscoveryProcess: (
    owner: ClaudeProcessOwner,
  ) => Effect.Effect<void, ProviderAdapterProcessError>;
}

export class ClaudeProcessOwnership extends ServiceMap.Service<
  ClaudeProcessOwnership,
  ClaudeProcessOwnershipShape
>()("glade/provider/Services/ClaudeProcessOwnership") {}
