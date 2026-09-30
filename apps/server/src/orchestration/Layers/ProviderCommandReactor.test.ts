import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import type {
  ModelSelection,
  OrchestrationCommand,
  OrchestrationEvent,
} from "@glade/contracts/orchestration/orchestration";
import type { ProviderForkThreadResult, ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/providerRuntime";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import {
  type ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@glade/contracts/orchestration/orchestration";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import type { DeepPartial } from "../../settings/settingsMerge";
import {
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  PubSub,
  Scope,
  Stream,
} from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentGatewayOperationRepositoryLive } from "../../agentGateway/Layers/AgentGatewayOperationRepository.ts";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { makeAgentGatewaySessionRegistry } from "../../agentGateway/Layers/AgentGatewaySessionRegistry.ts";
import {
  AgentGatewaySessionRegistry,
  type AgentGatewaySessionRegistryShape,
} from "../../agentGateway/Services/AgentGatewaySessionRegistry.ts";
import { ComputerManager } from "../../computer/ComputerManager.ts";
import { FakeComputerBackend } from "../../computer/FakeComputerBackend.ts";
import {
  ComputerService,
  type ComputerServiceShape,
} from "../../computer/Services/ComputerService.ts";
import { deriveServerPaths, ServerConfig } from "../../config.ts";
import { TextGenerationError } from "../../git/Errors.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from "../../provider/Errors.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventDeliveryRepositoryLive } from "../../persistence/Layers/OrchestrationEventDeliveries.ts";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { ProjectionPendingInteractionRepository } from "../../persistence/Services/ProjectionPendingInteractions.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import {
  ProviderRuntimeEventRepository,
  PROVIDER_RUNTIME_INGESTION_CONSUMER,
} from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  ProviderHealth,
  type ProviderHealthShape,
} from "../../provider/Services/ProviderHealth.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { TextGeneration, type TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { TurnCheckpointCoordinatorLive } from "./TurnCheckpointCoordinator.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import {
  classifyProviderAttemptOutcome,
  isSafeLegacyProviderBlocker,
  makeProviderCommandReactorLive,
} from "./ProviderCommandReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { OrchestrationCommandInvariantError, type OrchestrationDispatchError } from "../Errors.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { attachmentRelativePath } from "../../attachmentStore.ts";
import { resolveProviderAttachmentPath } from "../../provider/providerAttachmentPaths.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import {
  CheckpointStore,
  type CheckpointStoreShape,
} from "../../checkpointing/Services/CheckpointStore.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

describe("legacy provider blocker recovery", () => {
  it("rejects a startup failure only when process cleanup was confirmed", () => {
    const outcome = classifyProviderAttemptOutcome(
      Exit.fail(
        new ProviderAdapterProcessError({
          provider: "codex",
          threadId: ThreadId.makeUnsafe("thread-start-failed"),
          reason: "startup-failed",
          detail: "Codex stdout closed during initialization.",
        }),
      ),
    );
    expect(outcome._tag).toBe("rejected");
  });

  it("keeps process lifecycle failures uncertain", () => {
    const outcome = classifyProviderAttemptOutcome(
      Exit.fail(
        new ProviderAdapterProcessError({
          provider: "claudeAgent",
          threadId: ThreadId.makeUnsafe("thread-exit-unproven"),
          detail: "Provider process tree did not prove exit (rootExited=false).",
        }),
      ),
    );

    expect(outcome._tag).toBe("uncertain");
  });

  it("accepts only failures that prove the provider command was not executed", () => {
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree 66212 did not prove exit (rootExited=true, captureComplete=false; no captured descendants remain).",
      ),
    ).toBe(false);
    expect(
      isSafeLegacyProviderBlocker("Codex app-server stdin closed before the frame was written."),
    ).toBe(true);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider adapter request failed (codex) for thread/rollback: Invalid request: unknown variant `thread/rollback`",
      ),
    ).toBe(true);
    expect(isSafeLegacyProviderBlocker("thread/rollback timed out after send")).toBe(false);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree did not prove exit (rootExited=false, captureComplete=true).",
      ),
    ).toBe(false);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree did not prove exit (rootExited=true, captureComplete=false; captured descendants remain).",
      ),
    ).toBe(false);
    expect(isSafeLegacyProviderBlocker("Provider process tree did not prove exit.")).toBe(false);
    expect(isSafeLegacyProviderBlocker("Session stopped before request completed.")).toBe(false);
    expect(isSafeLegacyProviderBlocker("The provider rejected the prompt.")).toBe(false);
  });
});

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };

  return poll();
}

describe("ProviderCommandReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProviderCommandReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const createdStateDirs = new Set<string>();
  const createdBaseDirs = new Set<string>();

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const stateDir of createdStateDirs) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
    for (const baseDir of createdBaseDirs) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    createdBaseDirs.clear();
  });

  async function createHarness(input?: {
    readonly baseDir?: string;
    readonly threadModelSelection?: ModelSelection;
    readonly checkpointStore?: Partial<CheckpointStoreShape>;
    readonly forkThreadResult?: ProviderForkThreadResult | null;
    readonly startReactor?: boolean;
    readonly interruptTurn?: ProviderServiceShape["interruptTurn"];
    readonly commandEventTimeout?: Duration.Duration;
    readonly gatewayOperationId?: string;
    readonly gitWritingModelSelection?: ModelSelection;
    readonly omitStopRuntimeSession?: boolean;
    readonly serverSettings?: DeepPartial<ServerSettings>;
    readonly confirmNativeResume?: (resumeCursor: unknown) => boolean;
    readonly generateThreadTitle?: TextGenerationShape["generateThreadTitle"];
    readonly computerService?: ComputerServiceShape;
    readonly gatewaySessions?: AgentGatewaySessionRegistryShape;
    readonly getClaudeCacheObservation?: NonNullable<
      ProviderServiceShape["getClaudeCacheObservation"]
    >;
    readonly startClaudeCompaction?: NonNullable<ProviderServiceShape["startClaudeCompaction"]>;
  }) {
    const now = new Date().toISOString();
    const baseDir = input?.baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "glade-reactor-"));
    createdBaseDirs.add(baseDir);
    const { stateDir } = deriveServerPathsSync(baseDir, undefined);
    createdStateDirs.add(stateDir);
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    let nextSessionIndex = 1;
    const runtimeSessions: Array<ProviderSession> = [];
    const persistedResumeCursors = new Map<ThreadId, unknown>();
    const pendingPriorTranscriptBootstraps = new Set<ThreadId>();
    const listSessions = vi.fn<ProviderServiceShape["listSessions"]>(() =>
      Effect.succeed(runtimeSessions),
    );
    const modelSelection = input?.threadModelSelection ?? {
      provider: "codex",
      model: "gpt-5-codex",
    };
    const startSession = vi.fn<ProviderServiceShape["startSession"]>((_, input) => {
      const sessionIndex = nextSessionIndex++;
      const sessionModelSelection =
        typeof input === "object" && input !== null && "modelSelection" in input
          ? ((input as { modelSelection?: ModelSelection }).modelSelection ?? modelSelection)
          : modelSelection;
      const resumeCursor =
        typeof input === "object" && input !== null && "resumeCursor" in input
          ? input.resumeCursor
          : undefined;
      const threadId =
        typeof input === "object" &&
        input !== null &&
        "threadId" in input &&
        typeof input.threadId === "string"
          ? ThreadId.makeUnsafe(input.threadId)
          : ThreadId.makeUnsafe(`thread-${sessionIndex}`);
      const session: ProviderSession = {
        provider: sessionModelSelection.provider,
        status: "ready" as const,
        runtimeMode:
          typeof input === "object" &&
          input !== null &&
          "runtimeMode" in input &&
          (input.runtimeMode === "approval-required" || input.runtimeMode === "full-access")
            ? input.runtimeMode
            : "full-access",
        ...(sessionModelSelection.model !== undefined
          ? { model: sessionModelSelection.model }
          : {}),
        threadId,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        resumeCursor: resumeCursor ?? { opaque: `resume-${sessionIndex}` },
        createdAt: now,
        updatedAt: now,
      };
      runtimeSessions.push(session);
      return Effect.succeed(session);
    });
    const startSessionWithOutcome = vi.fn<
      NonNullable<ProviderServiceShape["startSessionWithOutcome"]>
    >((threadId, sessionInput, outcomeOptions) => {
      const effectiveResumeCursor =
        sessionInput.resumeCursor ?? persistedResumeCursors.get(threadId);
      const nativeResumeAttempted =
        effectiveResumeCursor !== undefined && effectiveResumeCursor !== null;
      const nativeResumeSucceeded =
        nativeResumeAttempted && (input?.confirmNativeResume?.(effectiveResumeCursor) ?? true);
      if (
        (outcomeOptions?.registerPriorTranscriptBootstrapOnFreshStart === true ||
          nativeResumeAttempted) &&
        !nativeResumeSucceeded
      ) {
        pendingPriorTranscriptBootstraps.add(threadId);
      }
      return startSession(threadId, sessionInput).pipe(
        Effect.map((session) => {
          const resolvedSession = nativeResumeSucceeded
            ? { ...session, resumeCursor: effectiveResumeCursor }
            : session;
          const runtimeIndex = runtimeSessions.findIndex(
            (candidate) => candidate.threadId === threadId,
          );
          if (runtimeIndex >= 0) {
            runtimeSessions[runtimeIndex] = resolvedSession;
          }
          persistedResumeCursors.set(threadId, resolvedSession.resumeCursor);
          return {
            session: resolvedSession,
            nativeResumeAttempted,
            nativeResumeSucceeded,
            priorTranscriptBootstrapPending: pendingPriorTranscriptBootstraps.has(threadId),
          };
        }),
      );
    });
    const completePriorTranscriptBootstrap = vi.fn<
      NonNullable<ProviderServiceShape["completePriorTranscriptBootstrap"]>
    >(({ threadId }) =>
      Effect.sync(() => {
        pendingPriorTranscriptBootstraps.delete(threadId);
      }),
    );
    const sendTurn = vi.fn<ProviderServiceShape["sendTurn"]>((_: unknown) =>
      Effect.succeed({
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-1"),
      }),
    );

    const setRuntimeSessionTurnState = (input: {
      readonly threadId: string;
      readonly status: ProviderSession["status"];
      readonly activeTurnId?: TurnId;
    }) => {
      const threadId = ThreadId.makeUnsafe(input.threadId);
      const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
      const base: ProviderSession = runtimeSessions[index] ?? {
        provider: modelSelection.provider,
        status: "ready",
        runtimeMode: "full-access",
        threadId,
        resumeCursor: { opaque: "resume-synthetic" },
        cwd: "/tmp/provider-project",
        createdAt: now,
        updatedAt: now,
      };
      const next: ProviderSession = {
        ...base,
        status: input.status,
        ...(input.activeTurnId !== undefined ? { activeTurnId: input.activeTurnId } : {}),
      };
      if (input.activeTurnId === undefined) {
        delete (next as { activeTurnId?: TurnId }).activeTurnId;
      }
      if (index >= 0) {
        runtimeSessions[index] = next;
      } else {
        runtimeSessions.push(next);
      }
    };
    const steerTurn = vi.fn((_: unknown) =>
      Effect.succeed({
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-steer-1"),
      }),
    );
    const startReview = vi.fn<ProviderServiceShape["startReview"]>((input) =>
      Effect.succeed({
        threadId: input.threadId,
        turnId: asTurnId("turn-review-1"),
      }),
    );
    const forkThread = vi.fn<NonNullable<ProviderServiceShape["forkThread"]>>((forkInput) =>
      Effect.sync(() => {
        const result = input?.forkThreadResult ?? null;
        const forkModelSelection = forkInput.modelSelection ?? modelSelection;
        if (result && !runtimeSessions.some((session) => session.threadId === forkInput.threadId)) {
          runtimeSessions.push({
            provider: forkModelSelection.provider,
            status: "ready",
            runtimeMode: forkInput.runtimeMode,
            ...(forkModelSelection.model !== undefined ? { model: forkModelSelection.model } : {}),
            threadId: forkInput.threadId,
            ...(result.resumeCursor !== undefined ? { resumeCursor: result.resumeCursor } : {}),
            createdAt: now,
            updatedAt: now,
          });
        }
        return result;
      }),
    );
    const interruptTurn = vi.fn(input?.interruptTurn ?? ((_: unknown) => Effect.void));
    const stopTask = vi.fn<ProviderServiceShape["stopTask"]>(() => Effect.void);
    const backgroundTask = vi.fn<ProviderServiceShape["backgroundTask"]>(() => Effect.void);
    const hasLiveRuntimeTasks = vi.fn<NonNullable<ProviderServiceShape["hasLiveRuntimeTasks"]>>(
      () => Effect.succeed(false),
    );
    const steerSubagent = vi.fn<ProviderServiceShape["steerSubagent"]>(() => Effect.void);
    const respondToRequest = vi.fn<ProviderServiceShape["respondToRequest"]>(() => Effect.void);
    const respondToUserInput = vi.fn<ProviderServiceShape["respondToUserInput"]>(() => Effect.void);
    const rollbackConversation = vi.fn<ProviderServiceShape["rollbackConversation"]>(
      () => Effect.void,
    );
    const restoreCheckpoint = vi.fn<CheckpointStoreShape["restoreCheckpoint"]>(() =>
      Effect.succeed(true),
    );
    const isGitRepository = vi.fn<CheckpointStoreShape["isGitRepository"]>(() =>
      Effect.succeed(false),
    );
    const captureCheckpoint = vi.fn<CheckpointStoreShape["captureCheckpoint"]>(() => Effect.void);
    const checkpointStore: CheckpointStoreShape = {
      isGitRepository,
      captureCheckpoint,
      copyCheckpointRef: () => Effect.succeed(true),
      hasCheckpointRef: () => Effect.succeed(false),
      restoreCheckpoint,
      reverseCheckpointDiff: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
      ...input?.checkpointStore,
    };
    const stopSession = vi.fn((input: unknown) =>
      Effect.sync(() => {
        const threadId =
          typeof input === "object" && input !== null && "threadId" in input
            ? (input as { threadId?: ThreadId }).threadId
            : undefined;
        if (!threadId) {
          return;
        }
        const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
        if (index >= 0) {
          runtimeSessions.splice(index, 1);
        }
        persistedResumeCursors.delete(threadId);
        pendingPriorTranscriptBootstraps.delete(threadId);
      }),
    );
    const stopRuntimeSession = vi.fn((input: unknown) =>
      Effect.sync(() => {
        const threadId =
          typeof input === "object" && input !== null && "threadId" in input
            ? (input as { threadId?: ThreadId }).threadId
            : undefined;
        if (!threadId) {
          return;
        }
        const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
        if (index >= 0) {
          runtimeSessions.splice(index, 1);
        }
      }),
    );
    const clearSessionResumeCursor = vi.fn<
      NonNullable<ProviderServiceShape["clearSessionResumeCursor"]>
    >((input) =>
      Effect.sync(() => {
        const preserveActiveRuntime =
          typeof input === "object" &&
          input !== null &&
          "preserveActiveRuntime" in input &&
          (input as { preserveActiveRuntime?: boolean }).preserveActiveRuntime === true;
        if (preserveActiveRuntime) {
          return;
        }
        const threadId =
          typeof input === "object" && input !== null && "threadId" in input
            ? (input as { threadId?: ThreadId }).threadId
            : undefined;
        if (!threadId) {
          return;
        }
        persistedResumeCursors.set(threadId, null);
        const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
        if (index >= 0) {
          runtimeSessions.splice(index, 1);
        }
      }),
    );
    const renameBranch = vi.fn((input: unknown) =>
      Effect.succeed({
        branch:
          typeof input === "object" &&
          input !== null &&
          "newBranch" in input &&
          typeof input.newBranch === "string"
            ? input.newBranch
            : "renamed-branch",
      }),
    );
    const publishBranch = vi.fn(() => Effect.void);
    const withMutation: GitCoreShape["withMutation"] = (_cwd, effect) => effect;
    const generateBranchName = vi.fn<TextGenerationShape["generateBranchName"]>(() =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateBranchName",
          detail: "disabled in test harness",
        }),
      ),
    );
    const generateThreadTitle = vi.fn<TextGenerationShape["generateThreadTitle"]>(
      input?.generateThreadTitle ??
        (() =>
          Effect.fail(
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: "disabled in test harness",
            }),
          )),
    );
    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const service: ProviderServiceShape = {
      startSession: startSession as ProviderServiceShape["startSession"],
      startSessionWithOutcome,
      completePriorTranscriptBootstrap,
      sendTurn: sendTurn as ProviderServiceShape["sendTurn"],
      steerTurn: steerTurn as ProviderServiceShape["steerTurn"],
      startReview,
      forkThread,
      interruptTurn: interruptTurn as ProviderServiceShape["interruptTurn"],
      stopTask,
      backgroundTask,
      hasLiveRuntimeTasks,
      steerSubagent,
      respondToRequest: respondToRequest as ProviderServiceShape["respondToRequest"],
      respondToUserInput: respondToUserInput as ProviderServiceShape["respondToUserInput"],
      stopSession: stopSession as ProviderServiceShape["stopSession"],
      ...(input?.omitStopRuntimeSession
        ? {}
        : {
            stopRuntimeSession: stopRuntimeSession as NonNullable<
              ProviderServiceShape["stopRuntimeSession"]
            >,
          }),
      clearSessionResumeCursor,
      listSessions,
      getCapabilities: (_provider) => Effect.succeed({}),
      rollbackConversation,
      compactThread: () => unsupported(),
      ...(input?.getClaudeCacheObservation
        ? { getClaudeCacheObservation: input.getClaudeCacheObservation }
        : {}),
      ...(input?.startClaudeCompaction
        ? { startClaudeCompaction: input.startClaudeCompaction }
        : {}),
      closeRuntimeEvents: Effect.void,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    };

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const layer = makeProviderCommandReactorLive(
      input?.commandEventTimeout === undefined
        ? undefined
        : { commandEventTimeout: input.commandEventTimeout },
    ).pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(TurnCheckpointCoordinatorLive),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provideMerge(
        input?.computerService
          ? Layer.succeed(ComputerService, input.computerService)
          : Layer.empty,
      ),
      Layer.provideMerge(
        input?.gatewaySessions
          ? Layer.succeed(AgentGatewaySessionRegistry, input.gatewaySessions)
          : Layer.empty,
      ),
      Layer.provideMerge(
        Layer.succeed(ProviderHealth, {
          getStatuses: Effect.succeed([]),
          refresh: Effect.succeed([]),
          updateProvider: () => Effect.die("updateProvider unsupported in test"),
          streamChanges: Stream.empty,
        } as unknown as ProviderHealthShape),
      ),
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(GitCore, {
          renameBranch,
          publishBranch,
          withMutation,
        } as unknown as GitCoreShape),
      ),
      Layer.provideMerge(
        Layer.succeed(TextGeneration, {
          generateBranchName,
          generateThreadTitle,
        } as unknown as TextGenerationShape),
      ),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          ...input?.serverSettings,
          ...(input?.gitWritingModelSelection
            ? { textGenerationModelSelection: input.gitWritingModelSelection }
            : {}),
        }),
      ),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
      Layer.provideMerge(ProviderRuntimeEventRepositoryLive),
      Layer.provideMerge(AgentGatewayOperationRepositoryLive),
      Layer.provideMerge(SqlitePersistenceMemory),
    );
    const runtime = ManagedRuntime.make(layer);
    const emitRuntimeEvent = (event: ProviderRuntimeEvent) =>
      Effect.runPromise(PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid));

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));

    const engineDispatchTarget = engine as {
      dispatch: OrchestrationEngineShape["dispatch"];
    };
    const passthroughDispatch = engineDispatchTarget.dispatch;
    const interceptEngineDispatch = (
      interceptor: (
        command: OrchestrationCommand,
      ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError> | undefined,
    ) => {
      engineDispatchTarget.dispatch = (command, context) =>
        interceptor(command) ?? passthroughDispatch(command, context);
    };
    const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor));
    const serverSettings = await runtime.runPromise(Effect.service(ServerSettingsService));
    const deliveryRepository = await runtime.runPromise(
      Effect.service(OrchestrationEventDeliveryRepository),
    );
    const queuedTurnPromotionRepository = await runtime.runPromise(
      Effect.service(QueuedTurnPromotionRepository),
    );
    const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
    const managedAttachments = await runtime.runPromise(
      Effect.service(ManagedAttachmentRepository),
    );
    const pendingInteractionRepository = await runtime.runPromise(
      Effect.service(ProjectionPendingInteractionRepository),
    );
    const runtimeEventRepository = await runtime.runPromise(
      Effect.service(ProviderRuntimeEventRepository),
    );
    const gatewayOperations = await runtime.runPromise(
      Effect.service(AgentGatewayOperationRepository),
    );
    scope = await Effect.runPromise(Scope.make("sequential"));
    let reactorStarted = false;
    const startReactor = async () => {
      if (reactorStarted) return;
      await Effect.runPromise(reactor.start.pipe(Scope.provide(scope!)));
      reactorStarted = true;
    };
    if (input?.startReactor !== false) {
      await startReactor();
    }
    const drain = () => Effect.runPromise(reactor.drain);

    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Provider Project",
        workspaceRoot: "/tmp/provider-project",
        defaultModelSelection: modelSelection,
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        ...(input?.gatewayOperationId
          ? {
              creationSource: "glade_mcp" as const,
              gatewayOperationId: input.gatewayOperationId,
              gatewayOperationIndex: 0,
            }
          : {}),
        createdAt: now,
      }),
    );

    return {
      engine,
      seedCompletion: () =>
        runtime!.runPromise(sql`
        INSERT INTO agent_gateway_completions
          (child_thread_id, creator_thread_id, initial_message_id, result_json, delivery_state, created_at)
        VALUES ('delegated-child', 'thread-1', 'delegated-initial', '{"summary":"delegated result","childThreadId":"delegated-child"}', 'delivered', ${new Date().toISOString()})
      `),
      completionState: () =>
        runtime!.runPromise(sql<{
          context_consumed: number;
          context_event_sequence: number | null;
        }>`
        SELECT context_consumed, context_event_sequence FROM agent_gateway_completions WHERE child_thread_id = 'delegated-child'
      `),
      reactor,
      serverSettings,
      startSession,
      startSessionWithOutcome,
      completePriorTranscriptBootstrap,
      pendingPriorTranscriptBootstraps,
      listSessions,
      sendTurn,
      steerTurn,
      startReview,
      forkThread,
      interruptTurn,
      stopTask,
      backgroundTask,
      hasLiveRuntimeTasks,
      steerSubagent,
      respondToRequest,
      respondToUserInput,
      rollbackConversation,
      isGitRepository,
      captureCheckpoint,
      restoreCheckpoint,
      stopSession,
      stopRuntimeSession,
      clearSessionResumeCursor,
      renameBranch,
      publishBranch,
      generateBranchName,
      generateThreadTitle,
      stateDir,
      stageAttachment: async (
        attachment: {
          readonly type: "image" | "file";
          readonly id: string;
          readonly name: string;
          readonly mimeType: string;
          readonly sizeBytes: number;
        },
        ownerThreadId = "thread-1",
      ) => {
        const flatRelativePath = attachmentRelativePath(attachment);
        const relativePath = attachment.id.startsWith("att_v2_")
          ? `objects/${attachment.id.slice(7, 9)}/${flatRelativePath}`
          : flatRelativePath;
        const attachmentPath = path.join(stateDir, "attachments", relativePath);
        fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
        if (!fs.existsSync(attachmentPath)) {
          fs.writeFileSync(attachmentPath, Buffer.alloc(attachment.sizeBytes));
        }
        const stagedAt = new Date().toISOString();
        await runtime.runPromise(
          managedAttachments
            .reserve({
              attachmentId: attachment.id,
              ownerThreadId,
              ownerKind: "local-loopback",
              ownerId: "local-loopback",
              kind: attachment.type,
              originalName: attachment.name,
              mimeType: attachment.mimeType,
              reservedBytes: attachment.sizeBytes,
              relativePath,
              now: stagedAt,
            })
            .pipe(
              Effect.andThen(
                managedAttachments.finalizeStaged({
                  attachmentId: attachment.id,
                  ownerThreadId,
                  ownerKind: "local-loopback",
                  ownerId: "local-loopback",
                  sizeBytes: attachment.sizeBytes,
                  sha256: "0".repeat(64),
                  stagingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                  now: stagedAt,
                }),
              ),
            ),
        );
        return attachmentPath;
      },
      drain,
      emitRuntimeEvent,
      setRuntimeSessionTurnState,
      startReactor,
      deliveryRepository,
      sql,
      pendingInteractionRepository,
      runtimeEventRepository,
      reserveGatewayOperation: (operationId: string) =>
        runtime.runPromise(
          gatewayOperations.reserve({
            operationId,
            callerThreadId: "caller-thread",
            callerTurnId: "caller-turn",
            operationKind: "create_threads",
            requestId: `request-${operationId}`,
            fingerprint: `fingerprint-${operationId}`,
            requestedCount: 1,
            planJson: "[]",
            now,
          }),
        ),
      markGatewayOperationDispatching: (operationId: string) =>
        runtime.runPromise(gatewayOperations.markDispatching({ operationId, now })),
      completeGatewayOperation: (operationId: string) =>
        runtime.runPromise(
          gatewayOperations.complete({
            operationId,
            resultJson: "{}",
            now: new Date().toISOString(),
          }),
        ),
      persistWithoutLivePublication: async (
        events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
      ) => {
        const persisted: OrchestrationEvent[] = [];
        for (const event of events) {
          const versions = await runtime.runPromise(sql<{ readonly version: number }>`
            SELECT COALESCE(MAX(stream_version), -1) + 1 AS version
            FROM orchestration_events
            WHERE aggregate_kind = ${event.aggregateKind}
              AND stream_id = ${event.aggregateId}
          `);
          const inserted = await runtime.runPromise(sql<{ readonly sequence: number }>`
            INSERT INTO orchestration_events (
              event_id, aggregate_kind, stream_id, stream_version, event_type,
              occurred_at, command_id, causation_event_id, correlation_id,
              actor_kind, payload_json, metadata_json
            ) VALUES (
              ${event.eventId}, ${event.aggregateKind}, ${event.aggregateId},
              ${versions[0]!.version}, ${event.type},
              ${event.occurredAt}, ${event.commandId}, ${event.causationEventId},
              ${event.correlationId}, 'user', ${JSON.stringify(event.payload)},
              ${JSON.stringify(event.metadata)}
            )
            RETURNING sequence
          `);
          const saved = { ...event, sequence: inserted[0]!.sequence } as OrchestrationEvent;
          persisted.push(saved);
          if (saved.type === "thread.message-sent") {
            await runtime.runPromise(sql`
              INSERT INTO projection_thread_messages (
                message_id, thread_id, turn_id, role, text, is_streaming,
                created_at, updated_at, source, sequence, dispatch_mode
              ) VALUES (
                ${saved.payload.messageId}, ${saved.payload.threadId}, ${saved.payload.turnId},
                ${saved.payload.role}, ${saved.payload.text},
                ${saved.payload.streaming ? 1 : 0}, ${saved.payload.createdAt},
                ${saved.payload.updatedAt}, ${saved.payload.source}, ${saved.sequence},
                ${saved.payload.dispatchMode ?? null}
              )
            `);
          }
        }
        return persisted;
      },
      persistSessionWithoutLivePublication: async (input: {
        readonly threadId: ThreadId;
        readonly turnId: TurnId;
        readonly updatedAt: string;
      }) =>
        runtime.runPromise(sql`
          INSERT INTO projection_thread_sessions (
            thread_id, status, provider_name, runtime_mode,
            active_turn_id, last_error, updated_at
          ) VALUES (
            ${input.threadId}, 'running', 'codex', 'approval-required',
            ${input.turnId}, NULL, ${input.updatedAt}
          )
          ON CONFLICT (thread_id) DO UPDATE SET
            status = excluded.status,
            provider_name = excluded.provider_name,
            runtime_mode = excluded.runtime_mode,
            active_turn_id = excluded.active_turn_id,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `),
      queuedTurnPromotionRepository,
      interceptEngineDispatch,
    };
  }

  async function seedRollbackTarget(
    harness: Awaited<ReturnType<typeof createHarness>>,
    input: {
      readonly messageId: MessageId;
      readonly turnId: TurnId;
      readonly createdAt: string;
    },
  ) {
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.messages.import",
        commandId: CommandId.makeUnsafe(`cmd-import-${input.messageId}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messages: [
          {
            messageId: input.messageId,
            role: "user",
            text: "rollback target",
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          },
        ],
        createdAt: input.createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe(`cmd-assistant-complete-${input.messageId}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe(`assistant-${input.messageId}`),
        turnId: input.turnId,
        createdAt: input.createdAt,
      }),
    );
  }

  async function readHarnessThread(
    harness: Awaited<ReturnType<typeof createHarness>>,
    threadId: ThreadId = ThreadId.makeUnsafe("thread-1"),
  ) {
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    return readModel.threads.find((thread) => thread.id === threadId);
  }

  async function dispatchHarnessUserTurn(
    harness: Awaited<ReturnType<typeof createHarness>>,
    input: {
      readonly messageId: string;
      readonly text: string;
      readonly createdAt: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
    },
  ) {
    return Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(`cmd-${input.messageId}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId(input.messageId),
          role: "user",
          text: input.text,
          attachments: input.attachments ?? [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: input.createdAt,
      }),
    );
  }

  describe("Claude cache review", () => {
    function expiredCacheObservation(): ClaudeCacheObservation {
      return {
        nativeSessionId: "native-claude-session-1",
        lifecycleGeneration: "generation-1",
        model: "claude-opus-4-6",
        observedAt: new Date().toISOString(),
        contextTokens: 120_000,
        lastResponseAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
        ttlSeconds: 3_600,
        state: "likely-expired",
        source: "request-usage",
      };
    }

    async function createCacheHarness(
      observation: () => ClaudeCacheObservation | undefined = expiredCacheObservation,
      startReactor = true,
    ) {
      return createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
        getClaudeCacheObservation: () => Effect.sync(observation),
        startReactor,
      });
    }

    async function sendHeldMessage(harness: Awaited<ReturnType<typeof createHarness>>) {
      await dispatchHarnessUserTurn(harness, {
        messageId: "cache-held-message",
        text: "Continue with this exact message",
        createdAt: new Date().toISOString(),
      });
      await waitFor(
        async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
      );
      await harness.drain();
      const review = (await readHarnessThread(harness))?.claudeCacheReview;
      expect(review).toBeTruthy();
      return review!;
    }

    async function respondToReview(
      harness: Awaited<ReturnType<typeof createHarness>>,
      review: NonNullable<Awaited<ReturnType<typeof readHarnessThread>>>["claudeCacheReview"],
      decision: "continue" | "compact" | "cancel",
      suffix: string = decision,
    ) {
      const command: OrchestrationCommand = {
        type: "thread.claude-cache.respond",
        commandId: CommandId.makeUnsafe(`cmd-cache-${suffix}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        reviewId: review!.reviewId,
        messageId: review!.messageId,
        decision,
        createdAt: new Date().toISOString(),
      };
      await Effect.runPromise(harness.engine.dispatch(command));
      await harness.drain();
      return command;
    }

    async function createCompactionHarness() {
      let observation = expiredCacheObservation();
      const startClaudeCompaction = vi.fn<
        NonNullable<ProviderServiceShape["startClaudeCompaction"]>
      >(({ threadId, turnId }) => Effect.succeed({ threadId, turnId }));
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
        getClaudeCacheObservation: () => Effect.sync(() => observation),
        startClaudeCompaction,
      });
      return {
        harness,
        startClaudeCompaction,
        setObservation: (next: ClaudeCacheObservation) => {
          observation = next;
        },
      };
    }

    async function emitCompactionTerminal(
      harness: Awaited<ReturnType<typeof createHarness>>,
      turnId: TurnId,
      input: {
        readonly state: "completed" | "failed" | "cancelled" | "aborted";
        readonly contextCompacted?: boolean;
      },
      suffix: string = input.state,
    ) {
      harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
      const base = {
        eventId: asEventId(`evt-cache-compaction-${suffix}`),
        provider: "claudeAgent" as const,
        threadId: ThreadId.makeUnsafe("thread-1"),
        createdAt: new Date().toISOString(),
        turnId,
        providerRefs: {},
      };
      await harness.emitRuntimeEvent(
        input.state === "aborted"
          ? { ...base, type: "turn.aborted", payload: { reason: "Compaction interrupted" } }
          : ({
              ...base,
              type: "turn.completed",
              payload: {
                state: input.state,
                ...(input.contextCompacted !== undefined
                  ? { contextCompacted: input.contextCompacted }
                  : {}),
              },
            } as ProviderRuntimeEvent),
      );
      await harness.drain();
    }

    it("persists compacting before native dispatch and keeps the user message pending", async () => {
      const { harness, startClaudeCompaction } = await createCompactionHarness();
      const review = await sendHeldMessage(harness);
      startClaudeCompaction.mockImplementation(({ threadId, turnId }) =>
        Effect.gen(function* () {
          const readModel = yield* harness.engine.getReadModel();
          expect(
            readModel.threads.find((thread) => thread.id === threadId)?.claudeCacheReview,
          ).toMatchObject({
            reviewId: review.reviewId,
            status: "compacting",
            compactionTurnId: turnId,
          });
          return { threadId, turnId };
        }),
      );

      await respondToReview(harness, review, "compact");

      expect(startClaudeCompaction).toHaveBeenCalledTimes(1);
      expect(harness.sendTurn).not.toHaveBeenCalled();
      const thread = await readHarnessThread(harness);
      expect(thread?.claudeCacheReview?.status).toBe("compacting");
      expect(
        thread?.messages.find((message) => message.id === review.messageId)?.turnId,
      ).toBeNull();
      await dispatchHarnessUserTurn(harness, {
        messageId: "cache-message-during-compaction",
        text: "Remain queued until the pending message is released",
        createdAt: new Date().toISOString(),
      });
      await harness.drain();
      expect(harness.sendTurn).not.toHaveBeenCalled();
    });

    it("releases the original message exactly once after matching successful compaction", async () => {
      const { harness, startClaudeCompaction, setObservation } = await createCompactionHarness();
      const review = await sendHeldMessage(harness);
      await respondToReview(harness, review, "compact");
      const turnId = startClaudeCompaction.mock.calls[0]?.[0].turnId;
      expect(turnId).toBeTruthy();
      setObservation({
        ...review.assessment,
        contextTokens: 16_000,
        state: "likely-warm",
        lastResponseAt: new Date().toISOString(),
      });

      await emitCompactionTerminal(harness, turnId!, {
        state: "completed",
        contextCompacted: true,
      });
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      await harness.drain();

      expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe("Continue with this exact message");
      expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
      expect(
        (await readHarnessThread(harness))?.messages.filter((message) => message.role === "user"),
      ).toHaveLength(1);
      expect((await readHarnessThread(harness))?.messages[0]?.turnId).not.toBe(turnId);
      await emitCompactionTerminal(
        harness,
        turnId!,
        { state: "completed", contextCompacted: true },
        "completed-duplicate",
      );
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    });

    it("does not release a failed compaction even when a native boundary was observed", async () => {
      const { harness, startClaudeCompaction } = await createCompactionHarness();
      const review = await sendHeldMessage(harness);
      await respondToReview(harness, review, "compact");
      const turnId = startClaudeCompaction.mock.calls[0]?.[0].turnId;
      expect(turnId).toBeTruthy();

      await emitCompactionTerminal(harness, turnId!, { state: "failed", contextCompacted: true });
      await waitFor(
        async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "failed",
      );

      expect(harness.sendTurn).not.toHaveBeenCalled();
    });

    it("does not compact before an original message that already requests /compact", async () => {
      const { harness, startClaudeCompaction } = await createCompactionHarness();
      await dispatchHarnessUserTurn(harness, {
        messageId: "cache-original-compact",
        text: "/compact Preserve the pending task",
        createdAt: new Date().toISOString(),
      });
      await waitFor(
        async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
      );
      const review = (await readHarnessThread(harness))?.claudeCacheReview;

      await respondToReview(harness, review, "compact");

      expect(startClaudeCompaction).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
    });

    it.each(["cache-revalidation", "persisted-compacting"] as const)(
      "fails a compact request when rollback removes its message during %s",
      async (stage) => {
        const observation = expiredCacheObservation();
        let getterCalls = 0;
        let releaseObservation!: (observation: ClaudeCacheObservation) => void;
        const observationGate = new Promise<ClaudeCacheObservation>((resolve) => {
          releaseObservation = resolve;
        });
        const startClaudeCompaction = vi.fn<
          NonNullable<ProviderServiceShape["startClaudeCompaction"]>
        >((input) => Effect.succeed(input));
        const harness = await createHarness({
          threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
          startClaudeCompaction,
          getClaudeCacheObservation: () => {
            getterCalls += 1;
            return stage === "cache-revalidation" && getterCalls === 2
              ? Effect.promise(() => observationGate)
              : Effect.succeed(observation);
          },
        });
        const review = await sendHeldMessage(harness);
        const rollback: OrchestrationCommand = {
          type: "thread.conversation.rollback.complete",
          commandId: CommandId.makeUnsafe("cmd-compact-authorization-rollback"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: review.messageId,
          numTurns: 1,
          createdAt: new Date().toISOString(),
        };
        let sawPersistedCompacting = false;
        if (stage === "persisted-compacting") {
          const dispatch = harness.engine.dispatch;
          harness.interceptEngineDispatch((command) => {
            if (
              command.type !== "thread.claude-cache.set" ||
              command.review?.status !== "compacting"
            )
              return undefined;
            return Effect.gen(function* () {
              const receipt = yield* dispatch(command);
              const thread = (yield* harness.engine.getReadModel()).threads.find(
                (candidate) => candidate.id === rollback.threadId,
              );
              expect(thread?.claudeCacheReview?.status).toBe("compacting");
              sawPersistedCompacting = true;
              yield* dispatch(rollback);
              return receipt;
            });
          });
        }
        try {
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.claude-cache.respond",
              commandId: CommandId.makeUnsafe("cmd-compact-authorization-respond"),
              threadId: ThreadId.makeUnsafe("thread-1"),
              reviewId: review.reviewId,
              messageId: review.messageId,
              decision: "compact",
              createdAt: new Date().toISOString(),
            }),
          );
          if (stage === "cache-revalidation") {
            await waitFor(() => getterCalls === 2);
            await Effect.runPromise(harness.engine.dispatch(rollback));
          }
        } finally {
          releaseObservation(observation);
        }
        await harness.drain();

        if (stage === "persisted-compacting") expect(sawPersistedCompacting).toBe(true);
        expect(startClaudeCompaction).not.toHaveBeenCalled();
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.messages).toEqual([]);
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
      },
    );

    it.each(["archive", "stop", "rollback"] as const)(
      "revokes an accepted Continue when %s arrives during cache revalidation",
      async (action) => {
        const observation = expiredCacheObservation();
        let getterCalls = 0;
        let releaseObservation!: (observation: ClaudeCacheObservation) => void;
        const observationGate = new Promise<ClaudeCacheObservation>((resolve) => {
          releaseObservation = resolve;
        });
        const harness = await createHarness({
          threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
          getClaudeCacheObservation: () => {
            getterCalls += 1;
            return getterCalls === 2
              ? Effect.promise(() => observationGate)
              : Effect.succeed(observation);
          },
        });
        const review = await sendHeldMessage(harness);
        try {
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.claude-cache.respond",
              commandId: CommandId.makeUnsafe("cmd-cache-continue-during-revalidation"),
              threadId: ThreadId.makeUnsafe("thread-1"),
              reviewId: review.reviewId,
              messageId: review.messageId,
              decision: "continue",
              createdAt: new Date().toISOString(),
            }),
          );
          await waitFor(() => getterCalls === 2);
          await Effect.runPromise(
            harness.engine.dispatch(
              action === "archive"
                ? {
                    type: "thread.archive",
                    commandId: CommandId.makeUnsafe("cmd-cache-archive-during-revalidation"),
                    threadId: ThreadId.makeUnsafe("thread-1"),
                  }
                : action === "stop"
                  ? {
                      type: "thread.session.stop",
                      commandId: CommandId.makeUnsafe("cmd-cache-stop-during-revalidation"),
                      threadId: ThreadId.makeUnsafe("thread-1"),
                      createdAt: new Date().toISOString(),
                    }
                  : {
                      type: "thread.conversation.rollback.complete",
                      commandId: CommandId.makeUnsafe("cmd-cache-rollback-during-revalidation"),
                      threadId: ThreadId.makeUnsafe("thread-1"),
                      messageId: review.messageId,
                      numTurns: 1,
                      createdAt: new Date().toISOString(),
                    },
            ),
          );
        } finally {
          releaseObservation(observation);
        }
        await harness.drain();

        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect((await readHarnessThread(harness))?.claudeCacheReview?.status).not.toBe(
          "responding",
        );
        if (action === "rollback") {
          expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
          expect((await readHarnessThread(harness))?.messages).toEqual([]);
        }
      },
    );

    it.each([
      "confirmed",
      "confirmed-after-reconciliation",
      "cancelled-confirmed",
      "cancelled-missing",
      "confirmed-unacknowledged",
      "confirmed-invariant-failure",
      "confirmed-infrastructure-defect",
      "confirmed-recovery-interrupted",
      "uncertain-missing",
      "failed-recovery-interrupted",
      "uncertain-user-delivery",
      "missing",
      "failed",
    ] as const)(
      "recovers %s compaction journal evidence without repeating native compaction",
      async (evidence) => {
        const now = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe("thread-1");
        const turnId = asTurnId("persisted-native-compaction-turn");
        const startClaudeCompaction = vi.fn<
          NonNullable<ProviderServiceShape["startClaudeCompaction"]>
        >((input) => Effect.succeed(input));
        const harness = await createHarness({
          threadModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
          startReactor: false,
          startClaudeCompaction,
          getClaudeCacheObservation: () =>
            Effect.succeed({
              ...expiredCacheObservation(),
              contextTokens: 16_000,
              state: "likely-warm",
              lastResponseAt: now,
            }),
        });
        const source = await dispatchHarnessUserTurn(harness, {
          messageId: "persisted-compaction-user",
          text: "Resume the saved original message",
          createdAt: now,
        });
        const review = {
          reviewId: "persisted-compaction-review",
          messageId: asMessageId("persisted-compaction-user"),
          sourceEventSequence: source.sequence,
          assessment: expiredCacheObservation(),
          status: "pending" as const,
          createdAt: now,
        };
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.set",
            commandId: CommandId.makeUnsafe("cmd-seed-compaction-review"),
            threadId,
            review,
            expectedReviewId: null,
            createdAt: now,
          }),
        );
        const compactResponse = await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.respond",
            commandId: CommandId.makeUnsafe("cmd-seed-compact-response"),
            threadId,
            reviewId: review.reviewId,
            messageId: review.messageId,
            decision: "compact",
            createdAt: now,
          }),
        );
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.claude-cache.set",
            commandId: CommandId.makeUnsafe("cmd-seed-compacting"),
            threadId,
            review: {
              ...review,
              status:
                evidence === "failed-recovery-interrupted"
                  ? "failed"
                  : evidence === "confirmed-after-reconciliation" ||
                      evidence === "uncertain-missing" ||
                      evidence.startsWith("cancelled-")
                    ? "uncertain"
                    : "compacting",
              compactionTurnId: turnId,
              compactionResponseEventSequence: compactResponse.sequence,
            },
            expectedReviewId: review.reviewId,
            createdAt: now,
          }),
        );
        for (const eventSequence of [source.sequence, compactResponse.sequence]) {
          await Effect.runPromise(
            harness.deliveryRepository.claim({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence,
              threadId,
              claimOwner: "previous-process",
              claimedAt: now,
              claimExpiresAt: now,
            }),
          );
          await Effect.runPromise(
            (evidence === "uncertain-missing" ||
              evidence === "failed-recovery-interrupted" ||
              evidence.startsWith("cancelled-")) &&
              eventSequence === compactResponse.sequence
              ? harness.deliveryRepository.markTerminalFailure({
                  consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                  eventSequence,
                  expectedClaimOwner: "previous-process",
                  state: "uncertain",
                  error: "Lost native compaction acknowledgement",
                  updatedAt: now,
                })
              : harness.deliveryRepository.complete({
                  consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
                  eventSequence,
                  claimOwner: "previous-process",
                  completedAt: now,
                }),
          );
        }
        let uncertainUserDeliverySequence: number | undefined;
        if (evidence === "uncertain-user-delivery") {
          const continued = await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.claude-cache.compacted",
              commandId: CommandId.makeUnsafe("cmd-previous-compact-release"),
              threadId,
              reviewId: review.reviewId,
              turnId,
              createdAt: now,
            }),
          );
          uncertainUserDeliverySequence = continued.sequence;
          await Effect.runPromise(
            harness.deliveryRepository.claim({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: continued.sequence,
              threadId,
              claimOwner: "previous-process",
              claimedAt: now,
              claimExpiresAt: now,
            }),
          );
          await Effect.runPromise(
            harness.deliveryRepository.markTerminalFailure({
              consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
              eventSequence: continued.sequence,
              expectedClaimOwner: "previous-process",
              state: "uncertain",
              error: "Lost user message acknowledgement",
              updatedAt: now,
            }),
          );
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.claude-cache.set",
              commandId: CommandId.makeUnsafe("cmd-uncertain-user-delivery"),
              threadId,
              review: {
                ...review,
                status: "uncertain",
                compactionTurnId: turnId,
                compactionResponseEventSequence: compactResponse.sequence,
              },
              expectedReviewId: review.reviewId,
              createdAt: now,
            }),
          );
        }
        let terminalSequence: number | undefined;
        if (
          evidence !== "missing" &&
          evidence !== "cancelled-missing" &&
          evidence !== "uncertain-missing" &&
          evidence !== "failed-recovery-interrupted" &&
          evidence !== "uncertain-user-delivery"
        ) {
          const terminal = await Effect.runPromise(
            harness.runtimeEventRepository.append({
              eventId: asEventId("journal-cache-compaction-terminal"),
              provider: "claudeAgent",
              threadId,
              createdAt: now,
              turnId,
              providerRefs: {},
              type: "turn.completed",
              payload: {
                state: evidence === "failed" ? "failed" : "completed",
                contextCompacted: true,
              },
            } as ProviderRuntimeEvent),
          );
          terminalSequence = terminal.sequence;
          if (evidence !== "confirmed-unacknowledged") {
            await Effect.runPromise(
              harness.runtimeEventRepository.advanceConsumerCursor({
                consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
                eventSequence: terminal.sequence,
                updatedAt: now,
              }),
            );
          }
        }

        if (evidence === "confirmed-invariant-failure") {
          const nextThreadId = ThreadId.makeUnsafe("thread-2");
          const nextTurnId = asTurnId("next-native-compaction-turn");
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.create",
              commandId: CommandId.makeUnsafe("cmd-next-cache-thread"),
              threadId: nextThreadId,
              projectId: asProjectId("project-1"),
              title: "Next recovered task",
              modelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              runtimeMode: "approval-required",
              branch: null,
              worktreePath: null,
              createdAt: now,
            }),
          );
          const nextSource = await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe("cmd-next-cache-message"),
              threadId: nextThreadId,
              message: {
                messageId: asMessageId("next-cache-message"),
                role: "user",
                text: "Continue the unaffected task",
                attachments: [],
              },
              runtimeMode: "approval-required",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt: now,
            }),
          );
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.claude-cache.set",
              commandId: CommandId.makeUnsafe("cmd-next-cache-review"),
              threadId: nextThreadId,
              review: {
                ...review,
                reviewId: "next-cache-review",
                messageId: asMessageId("next-cache-message"),
                sourceEventSequence: nextSource.sequence,
                status: "compacting",
                compactionTurnId: nextTurnId,
              },
              expectedReviewId: null,
              createdAt: now,
            }),
          );
          const nextTerminal = await Effect.runPromise(
            harness.runtimeEventRepository.append({
              eventId: asEventId("next-cache-terminal"),
              provider: "claudeAgent",
              threadId: nextThreadId,
              createdAt: now,
              turnId: nextTurnId,
              providerRefs: {},
              type: "turn.completed",
              payload: { state: "completed", contextCompacted: true },
            } as ProviderRuntimeEvent),
          );
          await Effect.runPromise(
            harness.runtimeEventRepository.advanceConsumerCursor({
              consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
              eventSequence: nextTerminal.sequence,
              updatedAt: now,
            }),
          );
        }
        if (
          evidence.startsWith("confirmed-") &&
          [
            "confirmed-invariant-failure",
            "confirmed-infrastructure-defect",
            "confirmed-recovery-interrupted",
          ].includes(evidence)
        ) {
          harness.interceptEngineDispatch((command) => {
            if (command.type !== "thread.claude-cache.compacted" || command.threadId !== threadId)
              return undefined;
            if (evidence === "confirmed-infrastructure-defect")
              return Effect.die(new Error("Simulated recovery infrastructure defect"));
            if (evidence === "confirmed-recovery-interrupted") return Effect.interrupt;
            return Effect.fail(
              new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "Simulated per-thread recovery invariant failure",
              }),
            );
          });
        }
        if (
          evidence === "confirmed-infrastructure-defect" ||
          evidence === "confirmed-recovery-interrupted"
        ) {
          await expect(harness.startReactor()).rejects.toThrow();
          expect(harness.sendTurn).not.toHaveBeenCalled();
          return;
        }
        if (evidence.startsWith("cancelled-")) {
          await Effect.runPromise(
            harness.engine.dispatch({
              type: "thread.session.stop",
              commandId: CommandId.makeUnsafe("cancel-before-recovery"),
              threadId,
              createdAt: now,
            }),
          );
          await dispatchHarnessUserTurn(harness, {
            messageId: "blocked-before-startup-recovery",
            text: "Do not replay this blocked send at startup",
            createdAt: now,
          });
        }
        await harness.startReactor();
        await harness.drain();

        expect(startClaudeCompaction).not.toHaveBeenCalled();
        if (evidence.startsWith("cancelled-")) {
          expect(harness.sendTurn).not.toHaveBeenCalled();
          expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
          expect(
            await Effect.runPromise(
              harness.reactor.listBlockingDeliveries({ threadId, limit: 10 }),
            ),
          ).toEqual([]);
          return;
        }
        if (evidence === "uncertain-user-delivery") {
          expect(harness.sendTurn).not.toHaveBeenCalled();
          expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("uncertain");
          expect(
            await Effect.runPromise(
              harness.reactor.listBlockingDeliveries({ threadId, limit: 10 }),
            ),
          ).toMatchObject([{ eventSequence: uncertainUserDeliverySequence, state: "uncertain" }]);
          return;
        }
        if (evidence === "confirmed-invariant-failure") {
          await waitFor(() => harness.sendTurn.mock.calls.length === 1);
          expect((await readHarnessThread(harness))?.claudeCacheReview).toMatchObject({
            status: "failed",
            error: "Simulated per-thread recovery invariant failure",
          });
          expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
            threadId: "thread-2",
            input: "Continue the unaffected task",
          });
          return;
        }
        if (evidence === "confirmed-unacknowledged") {
          expect(harness.sendTurn).not.toHaveBeenCalled();
          expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("compacting");
          await Effect.runPromise(
            harness.runtimeEventRepository.advanceConsumerCursor({
              consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
              eventSequence: terminalSequence!,
              updatedAt: new Date().toISOString(),
            }),
          );
        }
        if (
          evidence === "confirmed" ||
          evidence === "confirmed-after-reconciliation" ||
          evidence === "confirmed-unacknowledged"
        ) {
          await waitFor(() => harness.sendTurn.mock.calls.length === 1);

          await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview === null);
          expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe(
            "Resume the saved original message",
          );
          expect((await readHarnessThread(harness))?.claudeCacheReview).toBeNull();
        } else {
          expect(harness.sendTurn).not.toHaveBeenCalled();
          expect((await readHarnessThread(harness))?.claudeCacheReview?.status).toBe("failed");
          if (evidence === "uncertain-missing" || evidence === "failed-recovery-interrupted") {
            expect(
              await Effect.runPromise(
                harness.reactor.listBlockingDeliveries({ threadId, limit: 10 }),
              ),
            ).toEqual([]);
            const failedReview = (await readHarnessThread(harness))!.claudeCacheReview!;
            await respondToReview(harness, failedReview, "continue");
            await harness.drain();
            expect(harness.sendTurn).toHaveBeenCalledTimes(1);
            expect(harness.sendTurn.mock.calls[0]?.[0].input).toBe(
              "Resume the saved original message",
            );
            expect(startClaudeCompaction).not.toHaveBeenCalled();
          }
        }
      },
    );

    it("holds the first large expired-cache send and later queued messages", async () => {
      const harness = await createCacheHarness();
      const review = await sendHeldMessage(harness);

      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(review).toMatchObject({
        messageId: "cache-held-message",
        assessment: { state: "likely-expired", contextTokens: 120_000 },
      });
      expect((await readHarnessThread(harness))?.session?.status).toBe("ready");

      await dispatchHarnessUserTurn(harness, {
        messageId: "cache-later-message",
        text: "This message must remain queued",
        createdAt: new Date().toISOString(),
      });
      await harness.drain();

      const thread = await readHarnessThread(harness);
      expect(thread?.claudeCacheReview?.reviewId).toBe(review.reviewId);
      expect(thread?.messages.map((message) => message.id)).toEqual([
        "cache-held-message",
        "cache-later-message",
      ]);
      expect(harness.sendTurn).not.toHaveBeenCalled();
    });

    it("continues the persisted original message once and does not replay duplicate responses", async () => {
      const observation = expiredCacheObservation();
      const harness = await createCacheHarness(() => observation);
      const review = await sendHeldMessage(harness);

      const continueCommand = await respondToReview(harness, review, "continue");
      await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview == null);

      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
        threadId: "thread-1",
        input: "Continue with this exact message",
      });

      await Effect.runPromise(harness.engine.dispatch(continueCommand));
      await harness.drain();
      await expect(respondToReview(harness, review, "continue", "duplicate")).rejects.toThrow(
        "Command produced no events.",
      );
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      expect(
        (await readHarnessThread(harness))?.messages.filter((message) => message.role === "user"),
      ).toHaveLength(1);
    });

    it("cancels the send while retaining the original user message", async () => {
      const harness = await createCacheHarness();
      const review = await sendHeldMessage(harness);
      const pendingBeforeCancel = await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `);
      expect(pendingBeforeCancel).toHaveLength(1);

      await respondToReview(harness, review, "cancel");
      await waitFor(async () => (await readHarnessThread(harness))?.claudeCacheReview == null);

      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect((await readHarnessThread(harness))?.messages).toContainEqual(
        expect.objectContaining({
          id: "cache-held-message",
          role: "user",
          text: "Continue with this exact message",
        }),
      );
      expect(
        await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
      ).toEqual([]);
    });

    it("deletes a held pending turn when its thread is deleted", async () => {
      const harness = await createCacheHarness();
      await sendHeldMessage(harness);
      expect(
        await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
      ).toHaveLength(1);

      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-cache-hold"),
          threadId: ThreadId.makeUnsafe("thread-1"),
        }),
      );
      await harness.drain();

      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(
        await Effect.runPromise(harness.sql`
        SELECT pending_message_id FROM projection_turns
        WHERE thread_id = 'thread-1' AND turn_id IS NULL
      `),
      ).toEqual([]);
    });

    it("settles a removed held message as failed instead of leaving the review responding", async () => {
      const observation = expiredCacheObservation();
      const harness = await createCacheHarness(() => observation);
      const review = await sendHeldMessage(harness);
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.conversation.rollback.complete",
          commandId: CommandId.makeUnsafe("cmd-remove-held-message"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: review.messageId,
          numTurns: 1,
          createdAt: new Date().toISOString(),
        }),
      );
      expect((await readHarnessThread(harness))?.messages).toEqual([]);

      await respondToReview(harness, review, "continue");

      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect((await readHarnessThread(harness))?.claudeCacheReview).toMatchObject({
        reviewId: review.reviewId,
        status: "failed",
        error: expect.stringContaining("could not start"),
      });
    });

    it.each(["nativeSessionId", "lifecycleGeneration", "model"] as const)(
      "requires a new review when %s changes before Continue",
      async (field) => {
        let observation = expiredCacheObservation();
        const harness = await createCacheHarness(() => observation);
        const review = await sendHeldMessage(harness);
        observation = { ...observation, [field]: `${observation[field]}-changed` };

        await respondToReview(harness, review, "continue");
        await waitFor(
          async () => (await readHarnessThread(harness))?.claudeCacheReview?.status === "pending",
        );

        const renewedReview = (await readHarnessThread(harness))?.claudeCacheReview;
        expect(renewedReview?.reviewId).not.toBe(review.reviewId);
        expect(renewedReview?.messageId).toBe(review.messageId);
        expect(renewedReview?.assessment[field]).toBe(observation[field]);
        expect(harness.sendTurn).not.toHaveBeenCalled();
      },
    );
  });

  // The ambiguous command here is a conversation rollback whose provider interrupt cannot prove it
  // landed. A bare `thread.turn.interrupt` never quarantines a thread on purpose: it escalates to a
  // full session stop, so the stop button can never leave a thread blocked (see the exemption below).

  // Recovery contract when the client resumes a blocked thread: abandoning the blocker never replays
  // the ambiguous command itself, but the turn starts the quarantine skipped afterwards were provably
  // never sent, so they are replayed.

  it("promotes queued user work before an automatic goal continuation", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-goal-queue-priority"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goal: "Finish after handling user input",
        goalStartBehavior: "defer",
      }),
    );
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-before-goal-continuation"),
      messageId: asMessageId("msg-user-before-goal-continuation"),
      text: "User follow-up wins",
    });
    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    const goalStartedAt = (await readHarnessThread(harness))?.goalStartedAt;
    expect(goalStartedAt).toBeTruthy();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.goal.continue",
        commandId: CommandId.makeUnsafe("cmd-goal-continue-after-user-queue"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goalStartedAt: goalStartedAt!,
        trigger: "turn-completed",
        sourceTurnId: asTurnId("turn-before-goal-continuation"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: expect.stringContaining("User follow-up wins"),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0].input).not.toContain(
      "Continue working toward the active thread goal",
    );
  });

  it("interrupts a continuation that races a user stop", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    let releaseSend!: (result: { readonly threadId: ThreadId; readonly turnId: TurnId }) => void;
    const sendGate = new Promise<{ readonly threadId: ThreadId; readonly turnId: TurnId }>(
      (resolve) => {
        releaseSend = resolve;
      },
    );
    harness.sendTurn.mockImplementationOnce(() => Effect.promise(() => sendGate));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-goal-before-stop-race"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goal: "Stop this continuation",
        goalStartBehavior: "defer",
      }),
    );
    const goalStartedAt = (await readHarnessThread(harness))?.goalStartedAt;
    expect(goalStartedAt).toBeTruthy();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.goal.continue",
        commandId: CommandId.makeUnsafe("cmd-goal-continuation-before-stop"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goalStartedAt: goalStartedAt!,
        trigger: "turn-completed",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe("cmd-stop-racing-goal-continuation"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-before-goal-continuation"),
        createdAt: now,
      }),
    );
    releaseSend({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-goal-continuation-after-stop"),
    });

    await waitFor(() => harness.interruptTurn.mock.calls.length >= 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-goal-continuation-after-stop"),
    });
    expect((await readHarnessThread(harness))?.goalPausedAt).toBeTruthy();
  });

  it("preserves the provider resume cursor when interrupt escalation stops the runtime", async () => {
    const harness = await createHarness({
      interruptTurn: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "turn/interrupt",
            detail: "connection closed after request write",
          }),
        ),
    });
    const threadId = ThreadId.makeUnsafe("thread-1");
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-interrupt-escalation-turn"),
        threadId,
        message: {
          messageId: asMessageId("user-message-interrupt-escalation"),
          role: "user",
          text: "Start a turn that cannot be interrupted",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    harness.setRuntimeSessionTurnState({
      threadId,
      status: "running",
      activeTurnId: asTurnId("turn-interrupt-escalation"),
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe("cmd-interrupt-escalation"),
        threadId,
        turnId: asTurnId("turn-interrupt-escalation"),
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "stopped");
    expect(harness.interruptTurn).toHaveBeenCalledWith({
      threadId,
      turnId: asTurnId("turn-interrupt-escalation"),
    });
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(harness.stopRuntimeSession).toHaveBeenCalledWith({ threadId });

    await dispatchHarnessUserTurn(harness, {
      messageId: "interrupt-escalation-follow-up",
      text: "Continue after interrupt escalation",
      createdAt: new Date().toISOString(),
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.startSessionWithOutcome).toHaveBeenCalledTimes(2);
    const sessions = await Effect.runPromise(harness.listSessions());
    expect(sessions).toEqual([
      expect.objectContaining({ threadId, resumeCursor: { opaque: "resume-1" } }),
    ]);
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(harness.clearSessionResumeCursor).not.toHaveBeenCalled();
    expect(harness.completePriorTranscriptBootstrap).not.toHaveBeenCalled();
    const followUpInput = harness.sendTurn.mock.calls[1]?.[0];
    expect(followUpInput?.input).toBe("Continue after interrupt escalation");
  });

  it("interrupts the active provider turn before rolling back an edited message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-active"),
      turnId: asTurnId("turn-rollback-active"),
      createdAt: now,
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-rollback"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-active-edit"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.conversation.rollback",
        commandId: CommandId.makeUnsafe("cmd-conversation-rollback-active"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-active"),
        numTurns: 1,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.rollbackConversation.mock.calls.length === 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-active-edit"),
    });
    expect(harness.rollbackConversation.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.makeUnsafe("thread-1"),
      numTurns: 1,
    });
  });

  it("interrupts and rewinds the native conversation before resending an edited latest message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "edit-image-1",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 42,
    };
    const skill = {
      name: "docs",
      path: "/tmp/docs-skill",
    };
    const mention = {
      name: "README.md",
      path: "/tmp/project/README.md",
    };

    await harness.stageAttachment(imageAttachment);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-original-turn-start-for-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-edit"),
          role: "user",
          text: "old prompt",
          attachments: [imageAttachment],
          skills: [skill],
          mentions: [mention],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    harness.sendTurn.mockClear();
    harness.startSession.mockClear();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-active-edit-resend"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-and-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-edit"),
        text: "edited prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.stopRuntimeSession).not.toHaveBeenCalled();
    expect(harness.interruptTurn).toHaveBeenCalledOnce();
    expect(harness.rollbackConversation).toHaveBeenCalledOnce();
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "edited prompt",
      attachments: [imageAttachment],
      skills: [skill],
      mentions: [mention],
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));
    expect(thread?.messages.map((message) => message.text)).toEqual(["edited prompt"]);
    expect(thread?.messages[0]).toMatchObject({
      attachments: [imageAttachment],
      skills: [skill],
      mentions: [mention],
    });
  });

  it("dispatches managed attachments from their repository object paths", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "att_v2_aa000000000000000000000000000000",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const storagePath = await harness.stageAttachment(imageAttachment);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-managed-object-path-generic-title"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "New thread",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-managed-object-path"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("message-managed-object-path"),
          role: "user",
          text: "Inspect this image",
          attachments: [imageAttachment],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const sentAttachment = harness.sendTurn.mock.calls[0]?.[0].attachments?.[0];
    expect(sentAttachment).toMatchObject(imageAttachment);
    expect(
      sentAttachment &&
        resolveProviderAttachmentPath({
          attachmentsDir: path.join(harness.stateDir, "attachments"),
          attachment: sentAttachment,
        }),
    ).toBe(storagePath);

    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    const titleAttachment = harness.generateThreadTitle.mock.calls[0]?.[0].attachments?.[0];
    expect(
      titleAttachment &&
        resolveProviderAttachmentPath({
          attachmentsDir: path.join(harness.stateDir, "attachments"),
          attachment: titleAttachment,
        }),
    ).toBe(storagePath);
  });

  it("keeps queued-message edits queued while an active provider turn continues", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-running-edit-queued"),
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-queued"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-running-edit-queued"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-queued-before-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-queued-before-edit"),
          role: "user",
          text: "queued prompt",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await harness.drain();
    harness.stopRuntimeSession.mockClear();
    harness.rollbackConversation.mockClear();
    harness.sendTurn.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-queued-message"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("msg-queued-before-edit"),
        text: "edited queued prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await harness.drain();

    expect(harness.stopRuntimeSession).not.toHaveBeenCalled();
    expect(harness.rollbackConversation).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-edited-queue"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-edit-queued"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "edited queued prompt",
    });
  });

  it("preserves image attachment files while rolling back an edit resend", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "thread-1-12345678-1234-1234-1234-123456789abc",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const attachmentPath = path.join(
      harness.stateDir,
      "attachments",
      attachmentRelativePath(imageAttachment),
    );
    fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
    fs.writeFileSync(attachmentPath, Buffer.from([1, 2, 3, 4]));
    await harness.stageAttachment(imageAttachment);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-original-image-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-image-edit"),
          role: "user",
          text: "old image prompt",
          attachments: [imageAttachment],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(
      async () =>
        (await readHarnessThread(harness))?.messages.find(
          (message) => message.id === asMessageId("msg-image-edit"),
        )?.turnId != null,
    );
    const imageEditTurnId = (await readHarnessThread(harness))?.messages.find(
      (message) => message.id === asMessageId("msg-image-edit"),
    )?.turnId;
    if (!imageEditTurnId) throw new Error("Expected the image prompt to bind to a turn.");
    harness.sendTurn.mockClear();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-image-edit-assistant-complete"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("assistant-image-edit"),
        turnId: imageEditTurnId,
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-image-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("msg-image-edit"),
        text: "edited image prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(fs.existsSync(attachmentPath)).toBe(true);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: "edited image prompt",
      attachments: [imageAttachment],
    });
  });

  it("restores the previous filesystem checkpoint before resending a completed edit", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.isGitRepository.mockImplementationOnce(() => Effect.succeed(true));

    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-checkpoint-edit"),
      turnId: asTurnId("turn-checkpoint-edit"),
      createdAt: now,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.makeUnsafe("cmd-checkpoint-edit-complete"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-checkpoint-edit"),
        completedAt: now,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe("thread-1"), 1),
        status: "ready",
        files: [],
        assistantMessageId: asMessageId("assistant-user-message-checkpoint-edit"),
        checkpointTurnCount: 1,
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-checkpoint-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-checkpoint-edit"),
        text: "edited checkpoint prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith({
      cwd: "/tmp/provider-project",
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe("thread-1"), 0),
      fallbackToHead: true,
    });
  });

  it("rewinds a stopped conversation before resending an edited message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-restart-edit"),
      turnId: asTurnId("turn-restart-edit"),
      createdAt: now,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-restart-edit-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-restart-edit"),
        text: "edited after stop",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.rollbackConversation).toHaveBeenCalledWith({
      threadId: ThreadId.makeUnsafe("thread-1"),
      numTurns: 1,
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: "edited after stop",
    });
    expect((await readHarnessThread(harness))?.messages.map((message) => message.text)).toEqual([
      "edited after stop",
    ]);
  });

  it("keeps a textless stopped turn editable after its active turn id clears", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const threadId = ThreadId.makeUnsafe("thread-1");
    const messageId = asMessageId("user-textless-turn");
    await dispatchHarnessUserTurn(harness, {
      messageId,
      text: "original prompt",
      createdAt: now,
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(
      async () =>
        (await readHarnessThread(harness))?.messages.find((message) => message.id === messageId)
          ?.turnId != null,
    );
    const startedTurnId = (await readHarnessThread(harness))?.messages.find(
      (message) => message.id === messageId,
    )?.turnId;
    expect(startedTurnId).toBeTruthy();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-textless-turn-stopped"),
        threadId,
        session: {
          threadId,
          status: "stopped",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-textless-turn-edit"),
        threadId,
        messageId,
        text: "edited prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect((await readHarnessThread(harness))?.messages.map((message) => message.text)).toEqual([
      "edited prompt",
    ]);
  });

  it("preserves the transcript when the provider cannot recover the native edit boundary", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-stale"),
      turnId: asTurnId("turn-rollback-stale"),
      createdAt: now,
    });
    harness.rollbackConversation.mockImplementationOnce(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "thread/rollback",
          detail: "thread/resume failed: no rollout found for thread id 019db5ad",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-conversation-rollback-stale-resume"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-stale"),
        text: "corrected prompt",
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");
    expect(harness.clearSessionResumeCursor).not.toHaveBeenCalled();
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(
      (await readHarnessThread(harness))?.messages.some(
        (message) => message.id === "user-message-stale",
      ),
    ).toBe(true);
  });

  it("does not revive stale Computer consent when a durable queued turn is promoted after re-enable", async () => {
    const manager = new ComputerManager({ backend: new FakeComputerBackend() });
    const registry = makeAgentGatewaySessionRegistry();
    const threadId = ThreadId.makeUnsafe("thread-1");
    registry.issue(threadId, "codex", { additionalCapabilities: ["computer:control"] });
    const harness = await createHarness({
      gatewaySessions: registry,
      computerService: {
        supported: true,
        availability: { kind: "available", backend: "fake" },
        manager,
      },
    });
    const createdAt = new Date().toISOString();
    try {
      harness.setRuntimeSessionTurnState({
        threadId,
        status: "running",
        activeTurnId: asTurnId("computer-blocking"),
      });
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe("computer-queue-session"),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("computer-blocking"),
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        }),
      );
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("computer-queued-consent"),
          threadId,
          message: {
            messageId: asMessageId("computer-queued-message"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          enableComputerControl: true,
          computerControlGeneration: 0,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt,
        }),
      );
      await harness.drain();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      await manager.setControlEnabled(threadId, false);
      await manager.setControlEnabled(threadId, true);
      harness.setRuntimeSessionTurnState({ threadId, status: "ready" });
      await harness.emitRuntimeEvent({
        type: "turn.completed",
        eventId: asEventId("computer-blocking-completed"),
        provider: "codex",
        threadId,
        createdAt,
        turnId: asTurnId("computer-blocking"),
        payload: { state: "completed" },
        providerRefs: {},
      } as ProviderRuntimeEvent);
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      expect(harness.startSession.mock.calls.at(-1)?.[1].enableComputerControl).toBe(false);
    } finally {
      await manager.dispose();
    }
  });

  it("reacts to thread.turn.start by ensuring session and sending provider turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.listSessions.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-thread-goal-before-turn"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        goal: "Deliver <all> providers safely",
        goalStartBehavior: "defer",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-1"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.makeUnsafe("thread-1"));
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });
    const providerInput = harness.sendTurn.mock.calls[0]?.[0].input;
    expect(providerInput).toContain("<glade_goal>");
    expect(providerInput).toContain("Deliver &lt;all&gt; providers safely");
    expect(providerInput).toContain("</glade_goal>\n\nhello reactor");

    const thread = await readHarnessThread(harness);
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
    // One scan rechecks the provider's live-turn race before dispatch; the session ensure then performs
    // the only full lookup needed for startup.
    expect(harness.listSessions).toHaveBeenCalledTimes(2);
  });

  it("waits for the message-start checkpoint before sending the provider turn", async () => {
    let releaseCapture: (() => void) | undefined;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const captureCheckpoint = vi.fn<CheckpointStoreShape["captureCheckpoint"]>(() =>
      Effect.promise(() => captureGate),
    );
    const harness = await createHarness({
      checkpointStore: {
        isGitRepository: vi.fn<CheckpointStoreShape["isGitRepository"]>(() => Effect.succeed(true)),
        captureCheckpoint,
      },
    });
    const now = new Date().toISOString();

    const dispatch = Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-slow-checkpoint"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-slow-checkpoint"),
          role: "user",
          text: "hello despite slow git",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => captureCheckpoint.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(harness.sendTurn.mock.calls.length).toBe(0);

    releaseCapture?.();
    await dispatch;
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(captureCheckpoint.mock.calls.length).toBe(1);
    expect(captureCheckpoint.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/tmp/provider-project",
    });
    expect(captureCheckpoint.mock.calls[0]?.[0].checkpointRef).toContain("/message-start/");
  });

  it("marks the thread session errored when normal turn start fails", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.sendTurn.mockImplementationOnce(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "turn/start",
          detail: "turn start failed",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-fails"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-start-fails"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");

    const thread = await readHarnessThread(harness);
    expect(thread?.session?.status).toBe("error");
    expect(thread?.session?.activeTurnId).toBeNull();
    expect(thread?.session?.lastError).toBe(
      "Provider adapter request failed (codex) for turn/start: turn start failed",
    );
    expect(
      thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed"),
    ).toBe(true);
    await waitFor(async () => {
      const delivery = await Effect.runPromise(
        harness.deliveryRepository.firstBlockingDeliveryForThread({
          consumerName: "provider-command-reactor.v1",
          threadId: "thread-1",
        }),
      );
      return Option.isSome(delivery) && delivery.value.state === "uncertain";
    });
    const deliveryBlocker = await Effect.runPromise(
      harness.deliveryRepository.firstBlockingDeliveryForThread({
        consumerName: "provider-command-reactor.v1",
        threadId: "thread-1",
      }),
    );
    expect(deliveryBlocker.pipe(Option.getOrThrow)).toMatchObject({
      state: "uncertain",
      attemptCount: 1,
    });
  });

  it("surfaces a timed-out fresh turn start instead of leaving the thread starting", async () => {
    const harness = await createHarness({
      commandEventTimeout: Duration.millis(25),
    });
    const now = new Date().toISOString();
    harness.startSession.mockImplementationOnce(() => Effect.never);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-times-out"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-start-times-out"),
          role: "user",
          text: "hello stalled provider",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");
    const thread = await readHarnessThread(harness);
    expect(thread?.session?.activeTurnId).toBeNull();
    expect(thread?.session?.lastError).toContain("did not respond within 25ms");
    await waitFor(async () =>
      Boolean(
        (await readHarnessThread(harness))?.activities.some(
          (activity) =>
            activity.kind === "provider.turn.start.failed" &&
            (activity.payload as Record<string, unknown> | null)?.settlementStatus === "uncertain",
        ),
      ),
    );
  });

  async function seedQueuedTurnBehindLiveTurn(
    harness: Awaited<ReturnType<typeof createHarness>>,
    input: {
      readonly liveTurnId: TurnId;
      readonly messageId: MessageId;
      readonly text: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
    },
  ) {
    const now = new Date().toISOString();
    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: input.liveTurnId,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe(`cmd-session-running-${input.messageId}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: input.liveTurnId,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    harness.sendTurn.mockClear();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(`cmd-turn-${input.messageId}`),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: input.messageId,
          role: "user",
          text: input.text,
          attachments: [...(input.attachments ?? [])],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );
    await harness.drain();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((collected) => Array.from(collected)),
      ),
    );
    const queuedEvent = events.find(
      (event) => event.type === "thread.turn-queued" && event.payload.messageId === input.messageId,
    );
    expect(queuedEvent).toBeDefined();
    return queuedEvent!.sequence;
  }

  const settleLiveTurn = async (
    harness: Awaited<ReturnType<typeof createHarness>>,
    input: { readonly turnId: TurnId; readonly eventId: string },
  ) => {
    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId(input.eventId),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: input.turnId,
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);
  };

  it("drains a thread again after a promotion dispatch failed", async () => {
    const harness = await createHarness();
    const queuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-blocked"),
      messageId: asMessageId("msg-queue-blocked"),
      text: "promote me on the next settle",
    });

    let refusals = 0;
    harness.interceptEngineDispatch((command) => {
      if (command.type !== "thread.turn.dispatch-queued" || refusals > 0) {
        return undefined;
      }
      refusals += 1;
      return Effect.fail(
        new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Thread has a checkpoint revert in progress.",
        }),
      );
    });

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-blocked"),
      eventId: "evt-turn-completed-blocked",
    });
    await waitFor(() => refusals === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.sendTurn).not.toHaveBeenCalled();

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-blocked-later"),
      eventId: "evt-turn-completed-blocked-later",
    });

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "promote me on the next settle",
    });
    const promotion = await Effect.runPromise(
      harness.queuedTurnPromotionRepository.getBySequence(queuedSequence),
    );
    expect(promotion.pipe(Option.getOrThrow)).toMatchObject({ state: "promoted" });
  });

  it("drains a session again after a promoted turn start failed before dispatch", async () => {
    const harness = await createHarness();

    const attachment = {
      type: "image",
      id: `att_v2_${"a1b2c3d4".repeat(4)}`,
      name: "vanishes.png",
      mimeType: "image/png",
      sizeBytes: 3,
    } as const;
    const attachmentPath = await harness.stageAttachment(attachment);
    const queuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-reservation"),
      messageId: asMessageId("msg-queue-reservation"),
      text: "this promotion never reaches the provider",
      attachments: [attachment],
    });
    fs.rmSync(attachmentPath, { force: true });

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-reservation"),
      eventId: "evt-turn-completed-reservation",
    });

    await waitFor(async () => {
      const promotion = await Effect.runPromise(
        harness.queuedTurnPromotionRepository.getBySequence(queuedSequence),
      );
      return Option.getOrUndefined(promotion)?.state === "promoted";
    });
    expect(harness.sendTurn).not.toHaveBeenCalled();

    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-reservation-next"),
      messageId: asMessageId("msg-queue-reservation-next"),
      text: "promote me after the failed promotion",
    });
    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-reservation-next"),
      eventId: "evt-turn-completed-reservation-next",
    });

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "promote me after the failed promotion",
    });
  });

  it("does not promote another queued turn while the reactor is shutting down", async () => {
    const harness = await createHarness();
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-shutdown"),
      messageId: asMessageId("msg-queue-shutdown-1"),
      text: "first queued turn",
    });
    const secondQueuedSequence = await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-shutdown"),
      messageId: asMessageId("msg-queue-shutdown-2"),
      text: "stay queued for the next boot",
    });

    let promotionDispatches = 0;
    harness.interceptEngineDispatch((command) => {
      if (command.type === "thread.turn.dispatch-queued") {
        promotionDispatches += 1;
      }
      return undefined;
    });

    harness.sendTurn.mockImplementationOnce(() => Effect.never);

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-shutdown"),
      eventId: "evt-turn-completed-shutdown",
    });
    await waitFor(() => promotionDispatches === 1 && harness.sendTurn.mock.calls.length === 1);

    const activeScope = scope;
    expect(activeScope).not.toBeNull();
    await Effect.runPromise(Scope.close(activeScope!, Exit.void));
    scope = null;

    expect(promotionDispatches).toBe(1);
    const secondPromotion = await Effect.runPromise(
      harness.queuedTurnPromotionRepository.getBySequence(secondQueuedSequence),
    );
    expect(secondPromotion.pipe(Option.getOrThrow)).toMatchObject({
      state: "queued",
      claimOwner: null,
    });
  });

  it("releases a timed-out promoted turn when its live provider turn settles", async () => {
    const harness = await createHarness({
      commandEventTimeout: Duration.millis(25),
    });
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-timeout"),
      messageId: asMessageId("msg-queue-timeout-1"),
      text: "first queued turn times out after provider acceptance",
    });
    await seedQueuedTurnBehindLiveTurn(harness, {
      liveTurnId: asTurnId("turn-running-timeout"),
      messageId: asMessageId("msg-queue-timeout-2"),
      text: "second queued turn must drain after settlement",
    });

    const timedOutTurnId = asTurnId("turn-provider-accepted-before-timeout");
    harness.sendTurn.mockImplementationOnce(() =>
      Effect.sync(() =>
        harness.setRuntimeSessionTurnState({
          threadId: "thread-1",
          status: "running",
          activeTurnId: timedOutTurnId,
        }),
      ).pipe(Effect.andThen(Effect.never)),
    );

    await settleLiveTurn(harness, {
      turnId: asTurnId("turn-running-timeout"),
      eventId: "evt-turn-completed-timeout",
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(async () =>
      Effect.runPromise(
        harness.deliveryRepository
          .firstBlockingDeliveryForThread({
            consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
            threadId: "thread-1",
          })
          .pipe(Effect.map(Option.isSome)),
      ),
    );

    const blocker = (
      await Effect.runPromise(
        harness.deliveryRepository.firstBlockingDeliveryForThread({
          consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
          threadId: "thread-1",
        }),
      )
    ).pipe(Option.getOrThrow);
    await Effect.runPromise(
      harness.reactor.reconcileDelivery({
        eventSequence: blocker.eventSequence,
        threadId: ThreadId.makeUnsafe("thread-1"),
        expectedState: "uncertain",
        outcome: "abandon",
        reconciledBy: "test-operator",
        note: "The provider accepted the timed-out turn.",
      }),
    );

    await settleLiveTurn(harness, {
      turnId: timedOutTurnId,
      eventId: "evt-provider-turn-completed-after-timeout",
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "second queued turn must drain after settlement",
    });
  });

  it("keeps the next queued turn blocked until the promoted turn settles", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const firstSendGate: {
      release: ((value: { readonly threadId: ThreadId; readonly turnId: TurnId }) => void) | null;
    } = { release: null };

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-running-before-promotion"),
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-double-queue"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-running-before-promotion"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    harness.sendTurn.mockImplementationOnce(() =>
      Effect.tryPromise(
        () =>
          new Promise<{ readonly threadId: ThreadId; readonly turnId: TurnId }>((resolve) => {
            firstSendGate.release = resolve;
          }),
      ),
    );

    for (const [messageId, text] of [
      ["msg-queue-promoted-1", "first queued turn"],
      ["msg-queue-promoted-2", "second queued turn"],
    ] as const) {
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`cmd-turn-${messageId}`),
          threadId: ThreadId.makeUnsafe("thread-1"),
          message: {
            messageId: asMessageId(messageId),
            role: "user",
            text,
            attachments: [],
          },
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        }),
      );
    }

    await harness.drain();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-promote-first"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-before-promotion"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "first queued turn",
    });

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-promoted-1"),
    });
    expect(firstSendGate.release).not.toBeNull();
    firstSendGate.release?.({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-promoted-1"),
    });
    await harness.drain();

    // A duplicate/late terminal event for the previous turn can arrive after the promoted turn has
    // fully started. It must not release that promoted turn's session reservation or drain the next
    // queued message.
    await harness.emitRuntimeEvent({
      type: "turn.aborted",
      eventId: asEventId("evt-late-turn-aborted-after-promotion-started"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-before-promotion"),
      payload: {
        reason: "interrupted",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-promoted-first"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-promoted-1"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "second queued turn",
    });
  });

  it("queues a child-thread turn while the shared parent session runs and drains it on settle", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-child-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-child"),
        projectId: asProjectId("project-1"),
        parentThreadId: ThreadId.makeUnsafe("thread-1"),
        title: "Child",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-parent-running"),
    });
    harness.sendTurn.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-child-turn-start"),
        threadId: ThreadId.makeUnsafe("thread-child"),
        message: {
          messageId: asMessageId("msg-child-queued"),
          role: "user",
          text: "child follow-up",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      }),
    );

    await harness.drain();

    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-parent-turn-completed"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-parent-running"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-child"),
      input: "child follow-up",
    });
  });

  for (const interveningEvent of [false, true]) {
    it(`restores only its own optimistic state after a busy Claude rejection (concurrent event: ${interveningEvent})`, async () => {
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-fable-5-1" },
      });
      const threadId = ThreadId.makeUnsafe("thread-1");
      const createdAt = new Date().toISOString();
      const send = (id: string, options?: { autoCompactWindow: string }) =>
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(id),
          threadId,
          message: { messageId: asMessageId(id), role: "user", text: "continue", attachments: [] },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
          ...(options
            ? {
                modelSelection: {
                  provider: "claudeAgent" as const,
                  model: "claude-fable-5-1",
                  options,
                },
              }
            : {}),
        });
      await Effect.runPromise(send("bootstrap-busy"));
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      await harness.drain();
      const prior = (await Effect.runPromise(harness.engine.getReadModel())).threads[0]!.session!;
      harness.sendTurn.mockClear();
      harness.startSession.mockImplementationOnce(() =>
        Effect.gen(function* () {
          if (interveningEvent) {
            yield* harness.engine
              .dispatch({
                type: "thread.session.set",
                commandId: CommandId.makeUnsafe("late-runtime-event"),
                threadId,
                session: {
                  ...prior,
                  status: "running",
                  activeTurnId: asTurnId("late-turn"),
                  updatedAt: "2099-01-01T00:00:00.000Z",
                },
                createdAt: "2099-01-01T00:00:00.000Z",
              })
              .pipe(Effect.orDie);
          }
          return yield* new ProviderAdapterValidationError({
            provider: "claudeAgent",
            operation: "session/reconfigure",
            issue: "Background work is active",
          });
        }),
      );
      await Effect.runPromise(send("rejected-busy", { autoCompactWindow: "200k" }));
      await harness.drain();
      const after = (await Effect.runPromise(harness.engine.getReadModel())).threads[0]!.session!;
      expect(after).toMatchObject(
        interveningEvent
          ? { status: "running", activeTurnId: "late-turn" }
          : { status: "ready", activeTurnId: null, runtimeMode: prior.runtimeMode },
      );
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(harness.stopSession).not.toHaveBeenCalled();
    });
  }
});
