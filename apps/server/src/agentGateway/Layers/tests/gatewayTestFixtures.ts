import { VisualReplyPreviewLive } from "../../../visualReplies/Layers/VisualReplyPreview";
import { ManagedAttachmentRepositoryLive } from "../../../persistence/Layers/ManagedAttachments";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite";
import { AgentGatewayDiscovery } from "../../Services/AgentGatewayDiscovery";
import { AppPresentationLive } from "../AppPresentation";
import { CheckpointDiffQuery } from "../../../checkpointing/Services/CheckpointDiffQuery";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type {
  OrchestrationProjectShell,
  OrchestrationThread,
  OrchestrationThreadShell,
} from "@glade/contracts/orchestration/threadEntities";
import type { ProviderKind, ThreadId as ThreadIdType } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { MessageId, ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";

import { Deferred, Effect, Layer, Option, Stream } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { GitCore } from "../../../git/Services/GitCore.ts";
import { GitManager } from "../../../git/Services/GitManager.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTurnRepository } from "../../../persistence/Services/ProjectionTurns.ts";

import { OrchestrationEventStore } from "../../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEventDeliveryRepository } from "../../../persistence/Services/OrchestrationEventDeliveries.ts";
import { ProviderRuntimeEventRepository } from "../../../persistence/Services/ProviderRuntimeEvents.ts";
import { ThreadDiagnosticsQuery } from "../../../diagnostics/Services/ThreadDiagnosticsQuery.ts";
import { ProviderDiscoveryService } from "../../../provider/Services/ProviderDiscoveryService.ts";

import { ProviderHealth } from "../../../provider/Services/ProviderHealth.ts";
import { ServerConfig } from "../../../server/config.ts";
import { ServerSettingsService } from "../../../settings/serverSettings.ts";
import { AgentGateway } from "../../Services/AgentGateway.ts";
import { AgentGatewayCredentials } from "../../Services/AgentGatewayCredentials.ts";
import {
  AgentGatewayOperationRepository,
  type AgentGatewayOperationRecord,
} from "../../Services/AgentGatewayOperationRepository.ts";
import { AgentGatewayLive } from "../AgentGateway.ts";

import { recordCreatedWorktreeInPlan } from "../../operationPlan.ts";
import { makeAgentGatewayInFlightRequestRegistry } from "../../inFlightRequestRegistry.ts";

class InjectedFailure extends Error {
  readonly _tag = "InjectedFailure";
}

export const NOW = "2026-03-01T10:00:00.000Z";
export const PROJECT_ID = ProjectId.makeUnsafe("project-1");

function makeProjectShell(): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    kind: "project",
    title: "Demo project",
    workspaceRoot: "/tmp/demo",
    defaultModelSelection: null,
    isPinned: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function makeThreadShell(
  id: string,
  overrides?: Partial<OrchestrationThreadShell>,
): OrchestrationThreadShell {
  return {
    id: ThreadId.makeUnsafe(id),
    projectId: PROJECT_ID,
    title: `Thread ${id}`,
    modelSelection: { provider: "codex", model: "gpt-5.5" },
    runtimeMode: "approval-required",

    envMode: "local",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createBranchFlowCompleted: false,
    isPinned: false,
    parentThreadId: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    forkSourceThreadId: null,
    lastKnownPr: null,
    latestTurn:
      id === "thread-parent"
        ? {
            turnId: TurnId.makeUnsafe("turn-parent-active"),
            state: "running",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: null,
            assistantMessageId: null,
          }
        : null,
    latestUserMessageAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    handoff: null,
    session: null,
    ...overrides,
  };
}

export function makeThreadDetail(shell: OrchestrationThreadShell): OrchestrationThread {
  return {
    ...shell,
    deletedAt: null,
    pinnedMessages: [],
    messages: [],

    activities: [],
    checkpoints: [],
  };
}

const listDefaultTestModels: (typeof ProviderDiscoveryService)["Service"]["listModels"] = ({
  provider,
}) => {
  const modelsByProvider: Record<string, ReadonlyArray<ProviderModelDescriptor>> = {
    codex: [{ slug: "gpt-5.5", name: "GPT-5.5" }],
    claudeAgent: [{ slug: "claude-sonnet-5", name: "Claude Sonnet 5", isDefault: true }],
  };
  return Effect.succeed({ models: modelsByProvider[provider] ?? [], source: "test" });
};

interface GatewayHarness {
  readonly dispatched: Array<OrchestrationCommand>;
  readonly worktreeCreates: Array<{
    ref?: string;
    newBranch?: string;
    path?: string;
    copyChangesFrom?: string;
  }>;
  readonly worktreeRemoves: Array<{ path: string }>;
  readonly branchDeletes: Array<{ branch: string }>;
  readonly setThreadDetail: (thread: OrchestrationThread) => void;
  readonly setProjectionTurn: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly state: "pending" | "running" | "completed" | "error" | "interrupted";
    readonly assistantMessageId?: string | null;
  }) => void;
  readonly setProviderStatuses: (statuses: ReadonlyArray<ServerProviderStatus>) => void;
  readonly getOperationStatus: (callerTurnId: string) => string | null;
  readonly getOperationErrorCode: (callerTurnId: string) => string | null;
  readonly callTool: (input: {
    readonly token: string;
    readonly name: string;
    readonly args: Record<string, unknown>;
  }) => Effect.Effect<{ status: number; result: Record<string, unknown> | undefined }>;
}

const VALID_TOKENS: Record<string, string> = {
  "token-parent": "thread-parent",
  "token-parent-readonly": "thread-parent",
};

export function makeHarnessLayer(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  options: {
    readonly failDispatch?: (command: OrchestrationCommand) => boolean;
    readonly dispatchDelayMs?: number;
    readonly interruptedOperations?: ReadonlyArray<AgentGatewayOperationRecord>;
    readonly providerStatuses?: ReadonlyArray<ServerProviderStatus>;
    readonly existingWorktrees?: Readonly<Record<string, string>>;
    readonly verifiedOwnershipTokens?: ReadonlyArray<string>;
    readonly failRecordWorktreeOwnership?: boolean;
    readonly failOperationComplete?: boolean;
    readonly pauseAfterWorktreeCreate?: {
      readonly entered: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    };
    readonly pauseAfterDispatch?: {
      readonly commandType: OrchestrationCommand["type"];
      readonly entered: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    };
  } = {},
) {
  const unavailable = () =>
    Effect.die(new Error("This fixture does not exercise the new tool boundary."));
  const inFlightRequests = makeAgentGatewayInFlightRequestRegistry();
  const dispatched: Array<OrchestrationCommand> = [];
  const worktreeCreates: Array<{
    ref?: string;
    newBranch?: string;
    path?: string;
    copyChangesFrom?: string;
  }> = [];
  const worktreeRemoves: Array<{ path: string }> = [];
  const branchDeletes: Array<{ branch: string }> = [];
  const branchWorktreePaths = new Map<string, string | null>(
    Object.entries(options.existingWorktrees ?? {}),
  );
  const verifiedOwnershipTokens = new Set(options.verifiedOwnershipTokens ?? []);

  const credentialsLayer = Layer.succeed(AgentGatewayCredentials, {
    mcpEndpointUrl: "http://127.0.0.1:3773/mcp",
    setListeningPort: () => undefined,
    issueSessionToken: (threadId: ThreadIdType) => `token-for-${threadId}`,
    verifySessionToken: (token: string) => VALID_TOKENS[token] ?? null,
    verifySession: (token: string) => {
      const threadId = VALID_TOKENS[token];
      return threadId
        ? {
            sessionKey: `session-for-${threadId}`,
            threadId: ThreadId.makeUnsafe(threadId),
            provider: "codex" as const,
            issuedAt: 0,
            capabilities:
              token === "token-parent-readonly"
                ? new Set(["thread:read"] as const)
                : new Set(["thread:read", "thread:write", "diagnostics:read"] as const),
          }
        : null;
    },
    bindWriteAuthority: (token: string, turnId: string) => {
      const threadId = VALID_TOKENS[token];
      return threadId
        ? {
            sessionKey: `session-for-${threadId}`,
            threadId: ThreadId.makeUnsafe(threadId),
            provider: "codex" as const,
            turnId,
          }
        : null;
    },
    verifyWriteAuthority: (authority) =>
      authority.sessionKey === `session-for-${authority.threadId}`,
    registerInFlightRequest: inFlightRequests.register,
    cancelInFlightRequests: inFlightRequests.cancel,
    cancelSessionTurnRequests: (token, turnId) => {
      const threadId = VALID_TOKENS[token];
      return threadId
        ? inFlightRequests.cancelTurn(`session-for-${threadId}`, turnId).settled
        : Promise.resolve();
    },
    retireSessionTurn: (token, turnId) => {
      const threadId = VALID_TOKENS[token];
      return threadId
        ? inFlightRequests.cancelTurn(`session-for-${threadId}`, turnId).settled
        : Promise.resolve();
    },
    revokeSessionToken: () => undefined,
    connectionForThread: (threadId: ThreadIdType) => ({
      url: "http://127.0.0.1:3773/mcp",
      bearerToken: `token-for-${threadId}`,
    }),
  });

  const threadsById = new Map(threads.map((thread) => [thread.id as string, thread]));
  const threadDetailsById = new Map<string, OrchestrationThread>();
  const projectionTurnsByKey = new Map<
    string,
    {
      readonly threadId: string;
      readonly turnId: string;
      readonly state: "pending" | "running" | "completed" | "error" | "interrupted";
      readonly assistantMessageId: string | null;
    }
  >();

  const snapshotLayer = Layer.succeed(ProjectionSnapshotQuery, {
    getThreadShellById: (threadId: ThreadIdType) =>
      Effect.succeed(Option.fromNullishOr(threadsById.get(threadId as string))),
    getProjectShellById: (projectId: string) =>
      Effect.succeed(
        projectId === (PROJECT_ID as string)
          ? Option.some(makeProjectShell())
          : Option.none<OrchestrationProjectShell>(),
      ),
    getThreadDetailById: (threadId: ThreadIdType) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          threadDetailsById.get(threadId as string) ??
            Option.getOrUndefined(
              Option.map(
                Option.fromNullishOr(threadsById.get(threadId as string)),
                makeThreadDetail,
              ),
            ),
        ),
      ),
  } as unknown as (typeof ProjectionSnapshotQuery)["Service"]);

  const engineLayer = Layer.succeed(OrchestrationEngineService, {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sleep(options.dispatchDelayMs ?? 0).pipe(
        Effect.flatMap(() =>
          Effect.suspend(() => {
            dispatched.push(command);
            const result = options.failDispatch?.(command)
              ? Effect.fail(new InjectedFailure("injected dispatch failure"))
              : Effect.succeed({ sequence: dispatched.length });
            if (options.pauseAfterDispatch?.commandType !== command.type) return result;
            return Deferred.succeed(options.pauseAfterDispatch.entered, undefined).pipe(
              Effect.andThen(Deferred.await(options.pauseAfterDispatch.release)),
              Effect.andThen(result),
            );
          }),
        ),
      ),
  } as unknown as (typeof OrchestrationEngineService)["Service"]);

  const gitLayer = Layer.succeed(GitCore, {
    withMutation: <A, E, R>(_cwd: string, effect: Effect.Effect<A, E, R>) => effect,
    execute: () =>
      Effect.succeed({
        code: 0,
        stdout: "0123456789abcdef0123456789abcdef01234567\n",
        stderr: "",
      }),
    statusDetails: () => Effect.succeed({ isRepo: true, branch: "main" }),
    listBranches: () =>
      Effect.succeed({
        isRepo: true,
        hasOriginRemote: false,
        branches: [...branchWorktreePaths].map(([name, worktreePath]) => ({
          name,
          current: false,
          isDefault: false,
          worktreePath,
        })),
      }),
    createWorktree: (input: { newBranch?: string; path?: string }) =>
      Effect.gen(function* () {
        worktreeCreates.push(input);
        if (options.pauseAfterWorktreeCreate) {
          yield* Deferred.succeed(options.pauseAfterWorktreeCreate.entered, undefined);
          yield* Deferred.await(options.pauseAfterWorktreeCreate.release);
        }
        return {
          worktree: {
            path: input.path ?? `/tmp/worktrees/${input.newBranch ?? "generated"}`,
            branch: input.newBranch ?? "generated",
          },
        };
      }),
    createDetachedWorktree: (input: { ref: string; path?: string; newBranch?: string }) =>
      Effect.gen(function* () {
        worktreeCreates.push(input);
        if (options.pauseAfterWorktreeCreate) {
          yield* Deferred.succeed(options.pauseAfterWorktreeCreate.entered, undefined);
          yield* Deferred.await(options.pauseAfterWorktreeCreate.release);
        }
        return {
          worktree: {
            path: input.path ?? "/tmp/worktrees/generated/glade",
            ref: input.ref,
            branch: input.newBranch ?? null,
          },
        };
      }),
    fetchPullRequestCommit: unavailable,
    recordWorktreeOwnership: (input: { path: string; branch: string | null; token: string }) =>
      options.failRecordWorktreeOwnership
        ? Effect.fail(new InjectedFailure("injected ownership marker failure"))
        : Effect.sync(() => {
            verifiedOwnershipTokens.add(input.token);
            return {
              token: input.token,
              gitDir: `/tmp/git-admin/${input.token}`,
              branch: input.branch,
              head: `head:${input.branch ?? "detached"}`,
            };
          }),
    verifyWorktreeOwnership: (input: { proof: { token: string } }) =>
      Effect.succeed(
        verifiedOwnershipTokens.has(input.proof.token)
          ? { verified: true, reason: null }
          : { verified: false, reason: "ownership marker does not match" },
      ),
    removeWorktree: (input: { path: string }) =>
      Effect.sync(() => {
        worktreeRemoves.push(input);
      }),
    deleteBranch: (input: { branch: string }) =>
      Effect.sync(() => {
        branchDeletes.push(input);
      }),
    deleteBranchIfUnchanged: (input: { branch: string }) =>
      Effect.sync(() => {
        branchDeletes.push(input);
      }),
  } as unknown as (typeof GitCore)["Service"]);

  const providerDiscoveryLayer = Layer.succeed(ProviderDiscoveryService, {
    listModels: listDefaultTestModels,
  } as unknown as (typeof ProviderDiscoveryService)["Service"]);

  const providerKinds: ReadonlyArray<ProviderKind> = ["codex", "claudeAgent"];
  let providerStatuses =
    options.providerStatuses ??
    providerKinds.map(
      (provider): ServerProviderStatus => ({
        provider,
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW,
      }),
    );
  const providerHealthLayer = Layer.succeed(ProviderHealth, {
    getStatuses: Effect.sync(() => providerStatuses),
    refresh: Effect.sync(() => providerStatuses),
    updateProvider: () => Effect.die("Provider updates are not used by gateway tests."),
    streamChanges: Stream.empty,
  } as unknown as (typeof ProviderHealth)["Service"]);

  const operationsByScope = new Map<string, AgentGatewayOperationRecord>();
  for (const operation of options.interruptedOperations ?? []) {
    operationsByScope.set(
      `${operation.callerThreadId}:${operation.callerTurnId}:${operation.operationKind}`,
      operation,
    );
  }
  const operationLayer = Layer.succeed(AgentGatewayOperationRepository, {
    completions: {
      pending: () => Effect.succeed([]),
      isOutputSettled: () => Effect.succeed(true),
      hasCompletedRun: () => Effect.succeed(true),
      initialFailure: () => Effect.succeed(null),

      saveResult: () => Effect.void,
      delivered: () => Effect.void,
      claimContext: () => Effect.succeed(""),
      settleContext: (_sequence, _accepted, settle) => settle,
    },
    reserve: (input: {
      operationId: string;
      callerThreadId: string;
      callerTurnId: string;
      operationKind: "create_threads";
      requestId: string;
      fingerprint: string;
      requestedCount: number;
      planJson: string;
      now: string;
    }) =>
      Effect.sync(() => {
        const key = `${input.callerThreadId}:${input.callerTurnId}:${input.operationKind}`;
        const existing = operationsByScope.get(key);
        if (existing) {
          const kind =
            existing.requestId !== input.requestId
              ? "creation_plan_locked"
              : existing.fingerprint !== input.fingerprint
                ? "idempotency_conflict"
                : "replay";
          return { kind, operation: existing } as const;
        }
        const operation: AgentGatewayOperationRecord = {
          ...input,
          status: "reserved",
          resultJson: null,
          errorJson: null,
          createdAt: input.now,
          updatedAt: input.now,
        };
        operationsByScope.set(key, operation);
        return { kind: "reserved" as const, operation };
      }),
    markDispatching: ({ operationId, now }: { operationId: string; now: string }) =>
      Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (operation.operationId !== operationId || operation.status !== "reserved") continue;
          operationsByScope.set(key, { ...operation, status: "dispatching", updatedAt: now });
          return true;
        }
        return false;
      }),
    recordWorktreeCreated: (input: {
      operationId: string;
      index: number;
      workspaceRoot: string;
      path: string;
      branch: string | null;
      token: string;
      gitDir: string;
      head: string;
      now: string;
    }) =>
      Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (operation.operationId !== input.operationId || operation.status !== "dispatching") {
            continue;
          }
          operationsByScope.set(key, {
            ...operation,
            planJson: recordCreatedWorktreeInPlan({
              planJson: operation.planJson,
              ...input,
              recordedAt: input.now,
            }),
            updatedAt: input.now,
          });
          return true;
        }
        return false;
      }),
    markCompensating: ({ operationId, now }: { operationId: string; now: string }) =>
      Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (operation.operationId === operationId) {
            operationsByScope.set(key, {
              ...operation,
              status: "compensating",
              updatedAt: now,
            });
          }
        }
      }),
    recordCompensationFailure: ({
      operationId,
      errorJson,
      now,
    }: {
      operationId: string;
      errorJson: string;
      now: string;
    }) =>
      Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (
            operation.operationId === operationId &&
            (operation.status === "dispatching" || operation.status === "compensating")
          ) {
            operationsByScope.set(key, {
              ...operation,
              status: "compensating",
              errorJson,
              updatedAt: now,
            });
          }
        }
      }),
    complete: ({
      operationId,
      resultJson,
      now,
    }: {
      operationId: string;
      resultJson: string;
      now: string;
    }) => {
      if (options.failOperationComplete) {
        return Effect.fail(new InjectedFailure("injected operation completion failure"));
      }
      return Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (operation.operationId === operationId) {
            operationsByScope.set(key, {
              ...operation,
              status: "completed",
              resultJson,
              updatedAt: now,
            });
          }
        }
      });
    },
    fail: ({
      operationId,
      errorJson,
      now,
    }: {
      operationId: string;
      errorJson: string;
      now: string;
    }) =>
      Effect.sync(() => {
        for (const [key, operation] of operationsByScope) {
          if (operation.operationId === operationId) {
            operationsByScope.set(key, {
              ...operation,
              status: "failed",
              errorJson,
              updatedAt: now,
            });
          }
        }
      }),
    getById: (operationId: string) =>
      Effect.sync(
        () =>
          [...operationsByScope.values()].find(
            (operation) => operation.operationId === operationId,
          ) ?? null,
      ),
    getByScope: (input: {
      callerThreadId: string;
      callerTurnId: string;
      operationKind: "create_threads";
    }) =>
      Effect.sync(
        () =>
          operationsByScope.get(
            `${input.callerThreadId}:${input.callerTurnId}:${input.operationKind}`,
          ) ?? null,
      ),
    listNonTerminal: () =>
      Effect.sync(() =>
        [...operationsByScope.values()].filter(
          (operation) =>
            operation.status === "reserved" ||
            operation.status === "dispatching" ||
            operation.status === "compensating",
        ),
      ),
  });

  const readProjectionTurn = (threadId: string, turnId: string) => {
    const pinned = projectionTurnsByKey.get(`${threadId}:${turnId}`);
    if (pinned) {
      return {
        threadId: ThreadId.makeUnsafe(pinned.threadId),
        turnId: TurnId.makeUnsafe(pinned.turnId),
        pendingMessageId: null,

        assistantMessageId:
          pinned.assistantMessageId === null
            ? null
            : MessageId.makeUnsafe(pinned.assistantMessageId),
        state: pinned.state,
        requestedAt: NOW,
        startedAt: pinned.state === "pending" ? null : NOW,
        completedAt:
          pinned.state === "completed" || pinned.state === "error" || pinned.state === "interrupted"
            ? NOW
            : null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      };
    }
    const thread = threadsById.get(threadId);
    const turn = thread?.latestTurn;
    return turn?.turnId === turnId
      ? {
          threadId: ThreadId.makeUnsafe(threadId),
          turnId: TurnId.makeUnsafe(turnId),
          pendingMessageId: null,

          assistantMessageId: turn.assistantMessageId,
          state: turn.state,
          requestedAt: turn.requestedAt,
          startedAt: turn.startedAt,
          completedAt: turn.completedAt,
          checkpointTurnCount: null,
          checkpointRef: null,
          checkpointStatus: null,
          checkpointFiles: [],
        }
      : undefined;
  };
  const projectionTurnsLayer = Layer.succeed(ProjectionTurnRepository, {
    getManyWaitSnapshot: (input: {
      readonly threadIds: ReadonlyArray<string>;
      readonly turns: ReadonlyArray<{ threadId: string; turnId: string }>;
    }) =>
      Effect.sync(() => ({
        existingThreadIds: input.threadIds.filter((threadId) => threadsById.has(threadId)),
        turns: input.turns.flatMap(({ threadId, turnId }) => {
          const turn = readProjectionTurn(threadId, turnId);
          return turn ? [turn] : [];
        }),
      })),
  } as unknown as (typeof ProjectionTurnRepository)["Service"]);

  const gatewayLayer = AgentGatewayLive.pipe(
    Layer.provide(VisualReplyPreviewLive),
    Layer.provide(ManagedAttachmentRepositoryLive.pipe(Layer.provide(SqlitePersistenceMemory))),
    Layer.provide(
      Layer.mergeAll(
        AppPresentationLive,
        Layer.succeed(AgentGatewayDiscovery, {
          listProjects: Effect.succeed([makeProjectShell()]),
          listThreads: () =>
            Effect.succeed({ threads: [...threadsById.values()], nextCursor: null }),
        }),
        Layer.succeed(CheckpointDiffQuery, {
          getTurnDiff: unavailable,
          getFullThreadDiff: unavailable,
          previewWorkspaceRestore: unavailable,
        }),
        Layer.succeed(ThreadDiagnosticsQuery, {
          getActivityCoverage: unavailable,
          listActivities: unavailable,
          recordOperationalDiagnostic: unavailable,
          listOperationalDiagnostics: unavailable,
        }),
        Layer.succeed(OrchestrationEventStore, {
          append: unavailable,
          getHighWaterSequence: unavailable,
          getThreadHighWaterSequence: unavailable,
          getThreadTitleHighWaterSequence: unavailable,
          readThreadEvents: unavailable,
          readThreadEventsFromSequence: () => Stream.fromEffect(unavailable()),
          readFromSequence: () => Stream.fromEffect(unavailable()),
          readAll: () => Stream.fromEffect(unavailable()),
        }),
        Layer.succeed(OrchestrationEventDeliveryRepository, {
          listBlockingDeliveries: unavailable,
        } as unknown as (typeof OrchestrationEventDeliveryRepository)["Service"]),
        Layer.succeed(ProviderRuntimeEventRepository, {
          getThreadCoverage: unavailable,
          readThreadEvents: unavailable,
        } as unknown as (typeof ProviderRuntimeEventRepository)["Service"]),
        Layer.succeed(GitManager, {
          resolvePullRequest: unavailable,
        } as unknown as (typeof GitManager)["Service"]),
      ),
    ),
    Layer.provide(credentialsLayer),
    Layer.provide(snapshotLayer),
    Layer.provide(engineLayer),
    Layer.provide(gitLayer),
    Layer.provide(providerDiscoveryLayer),
    Layer.provide(providerHealthLayer),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(operationLayer),
    Layer.provide(projectionTurnsLayer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provide(NodeServices.layer),
  );

  const makeHarness = Effect.gen(function* () {
    const gateway = yield* AgentGateway;
    const callTool: GatewayHarness["callTool"] = ({ token, name, args }) =>
      gateway
        .handleMcpPost({
          authorizationHeader: `Bearer ${token}`,
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          },
        })
        .pipe(
          Effect.map((response) => ({
            status: response.status,
            result: (response.body as { result?: Record<string, unknown> } | undefined)?.result,
          })),
        );
    return {
      dispatched,
      worktreeCreates,
      worktreeRemoves,
      branchDeletes,
      setThreadDetail: (thread) => {
        threadsById.set(thread.id, thread);
        threadDetailsById.set(thread.id, thread);
      },
      setProjectionTurn: (input) => {
        projectionTurnsByKey.set(`${input.threadId}:${input.turnId}`, {
          threadId: input.threadId,
          turnId: input.turnId,
          state: input.state,
          assistantMessageId: input.assistantMessageId ?? null,
        });
      },
      setProviderStatuses: (statuses) => {
        providerStatuses = statuses;
      },
      getOperationStatus: (callerTurnId) =>
        [...operationsByScope.values()].find((operation) => operation.callerTurnId === callerTurnId)
          ?.status ?? null,
      getOperationErrorCode: (callerTurnId) => {
        const errorJson = [...operationsByScope.values()].find(
          (operation) => operation.callerTurnId === callerTurnId,
        )?.errorJson;
        if (!errorJson) return null;
        return (JSON.parse(errorJson) as { code?: string }).code ?? null;
      },
      callTool,
    } satisfies GatewayHarness;
  });

  return { gatewayLayer, makeHarness };
}

export function toolResultJson(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const content = (result?.content as Array<{ text: string }> | undefined) ?? [];
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
}

export function isToolError(result: Record<string, unknown> | undefined): boolean {
  return result?.isError === true;
}

export function toolErrorText(result: Record<string, unknown> | undefined): string {
  const content = (result?.content as Array<{ text: string }> | undefined) ?? [];
  return content[0]?.text ?? "";
}

export const baseThreads = [
  makeThreadShell("thread-parent"),
  makeThreadShell("thread-child", { parentThreadId: ThreadId.makeUnsafe("thread-parent") }),
  makeThreadShell("thread-archived", { archivedAt: NOW }),
];
