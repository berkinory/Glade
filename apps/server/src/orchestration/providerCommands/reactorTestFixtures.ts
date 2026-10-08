import { ProviderSessionDirectoryLive } from "../../provider/Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime";
import { HandoffPreparation } from "../Services/HandoffPreparation";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import { HandoffTransitionsLive } from "../Layers/HandoffTransitions";
import { seedUserMessage } from "../persistedMessage.testSupport";
import {
  ThreadTitleGeneration,
  type ThreadTitleGenerationShape,
} from "../Services/ThreadTitleGeneration";
import type { ReactorTestHarness } from "./reactorTestTypes";
import {
  ProjectId,
  EventId,
  MessageId,
  TurnId,
  ThreadId,
  CommandId,
} from "@glade/contracts/core/baseSchemas";
import {
  Effect,
  ManagedRuntime,
  Scope,
  Exit,
  Duration,
  PubSub,
  Stream,
  Layer,
  Option,
} from "effect";
import { deriveServerPaths, ServerConfig } from "../../server/config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { afterEach, vi, expect } from "vitest";
import fs from "node:fs";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import {
  type CheckpointStoreShape,
  CheckpointStore,
} from "../../checkpointing/Services/CheckpointStore.ts";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import {
  type ProviderServiceShape,
  ProviderService,
} from "../../provider/Services/ProviderService.ts";
import type { DeepPartial } from "../../settings/settingsMerge";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import { type TextGenerationShape, TextGeneration } from "../../git/Services/TextGeneration.ts";
import path from "node:path";
import os from "node:os";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { type GitCoreShape, GitCore } from "../../git/Services/GitCore.ts";
import { TextGenerationError } from "../../git/Errors.ts";
import { OrchestrationEngineLive } from "../Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../Layers/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { makeProviderCommandReactorLive } from "../Layers/ProviderCommandReactor.ts";
import { TurnCheckpointCoordinatorLive } from "../Layers/TurnCheckpointCoordinator.ts";
import {
  ProviderHealth,
  type ProviderHealthShape,
} from "../../provider/Services/ProviderHealth.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { OrchestrationEventDeliveryRepositoryLive } from "../../persistence/Layers/OrchestrationEventDeliveries.ts";
import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents.ts";
import { AgentGatewayOperationRepositoryLive } from "../../agentGateway/Layers/AgentGatewayOperationRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { type OrchestrationDispatchError } from "../Errors.ts";
import { OrchestrationEventDeliveryRepository } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents.ts";

import { attachmentRelativePath } from "../../attachments/attachmentStore.ts";
import { type ChatAttachment } from "@glade/contracts/orchestration/threadEntities";

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

export const asEventId = (value: string): EventId => EventId.makeUnsafe(value);

export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);

export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)));

export async function waitFor(
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

export function makeReactorTestHarness() {
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
    readonly handoffContext?: string;
    readonly threadModelSelection?: ModelSelection;
    readonly checkpointStore?: Partial<CheckpointStoreShape>;
    readonly startReactor?: boolean;
    readonly updateNativeHistory?: ProviderServiceShape["updateNativeHistory"];
    readonly commandEventTimeout?: Duration.Duration;
    readonly serverSettings?: DeepPartial<ServerSettings>;
  }): Promise<ReactorTestHarness> {
    const now = new Date().toISOString();
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-reactor-"));
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
      const nativeResumeSucceeded = nativeResumeAttempted;
      if (
        outcomeOptions?.registerPriorTranscriptBootstrapOnFreshStart === true &&
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
            lifecycleGeneration: `fixture-generation-${crypto.randomUUID()}`,
            nativeResumeAttempted,
            nativeResumeSucceeded,
            priorTranscriptBootstrapPending: pendingPriorTranscriptBootstraps.has(threadId),
          };
        }),
      );
    });
    const completePriorTranscriptBootstrap: NonNullable<
      ProviderServiceShape["completePriorTranscriptBootstrap"]
    > = ({ threadId }) =>
      Effect.sync(() => {
        pendingPriorTranscriptBootstraps.delete(threadId);
      });
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
    const interruptTurn = vi.fn((_: unknown) => Effect.void);
    const rollbackConversation = vi.fn<ProviderServiceShape["rollbackConversation"]>(
      () => Effect.void,
    );
    const isGitRepository = vi.fn<CheckpointStoreShape["isGitRepository"]>(() =>
      Effect.succeed(false),
    );
    const restoreScopedCheckpoint = vi.fn<CheckpointStoreShape["restoreScopedCheckpoint"]>(
      () => Effect.void,
    );
    const checkpointStore: CheckpointStoreShape = {
      isGitRepository,
      captureCheckpoint: () => Effect.void,
      copyCheckpointRef: () => Effect.succeed(true),
      hasCheckpointRef: () => Effect.succeed(false),
      previewScopedRestore: () => Effect.succeed({ fingerprint: "empty", files: [] }),
      restoreScopedCheckpoint,
      diffCheckpoints: () => Effect.succeed(""),
      summarizeCheckpointDiff: () => Effect.succeed([]),
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
    const withMutation: GitCoreShape["withMutation"] = (_cwd, effect) => effect;
    const generateTitle = vi.fn<ThreadTitleGenerationShape["generate"]>(() =>
      Effect.succeed("Generated conversation title"),
    );
    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const service: ProviderServiceShape = {
      startSession: startSession as ProviderServiceShape["startSession"],
      startSessionWithOutcome,
      completePriorTranscriptBootstrap,
      sendTurn: sendTurn as ProviderServiceShape["sendTurn"],
      steerTurn: steerTurn as ProviderServiceShape["steerTurn"],
      startReview: (reviewInput) =>
        Effect.succeed({ threadId: reviewInput.threadId, turnId: asTurnId("turn-review-1") }),
      forkThread: () => unsupported(),
      interruptTurn: interruptTurn as ProviderServiceShape["interruptTurn"],
      stopTask: () => Effect.void,
      backgroundTask: () => Effect.void,
      hasLiveRuntimeTasks: () => Effect.succeed(false),
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: stopSession as ProviderServiceShape["stopSession"],
      stopRuntimeSession: stopRuntimeSession as ProviderServiceShape["stopRuntimeSession"],
      clearSessionResumeCursor,
      listSessions,
      getCapabilities: (_provider) => Effect.succeed({}),
      rollbackConversation,
      compactThread: () => unsupported(),
      updateNativeHistory: input?.updateNativeHistory ?? (() => unsupported()),
      closeRuntimeEvents: Effect.void,
      getRuntimeEventPumpHealth: () => Effect.succeed([]),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    };

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provideMerge(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const layer = makeProviderCommandReactorLive(
      input?.commandEventTimeout === undefined
        ? undefined
        : { commandEventTimeout: input.commandEventTimeout },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          input?.handoffContext ? HandoffTransitionsLive : Layer.empty,
          input?.handoffContext
            ? Layer.succeed(HandoffPreparation, {
                prepare: () => Effect.succeed(input.handoffContext!),
                cancel: () => Effect.succeed(false),
              })
            : Layer.empty,
        ),
      ),
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(TurnCheckpointCoordinatorLive),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provideMerge(
        Layer.succeed(ProviderHealth, {
          getStatuses: Effect.succeed([]),
          refresh: Effect.succeed([]),
          updateProvider: () => Effect.die("updateProvider unsupported in test"),
          streamChanges: Stream.empty,
        } as unknown as ProviderHealthShape),
      ),
      Layer.provideMerge(
        Layer.succeed(ThreadTitleGeneration, {
          generate: generateTitle,
        }),
      ),
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(GitCore, {
          renameBranch: (renameInput: { readonly newBranch: string }) =>
            Effect.succeed({ branch: renameInput.newBranch }),
          publishBranch: () => Effect.void,
          withMutation,
        } as unknown as GitCoreShape),
      ),
      Layer.provideMerge(
        Layer.succeed(TextGeneration, {
          generateBranchName: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateBranchName",
                detail: "disabled in test harness",
              }),
            ),
        } as unknown as TextGenerationShape),
      ),
      Layer.provideMerge(ServerSettingsService.layerTest({ ...input?.serverSettings })),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
      Layer.provideMerge(ProviderRuntimeEventRepositoryLive),
      Layer.provideMerge(AgentGatewayOperationRepositoryLive),
      Layer.provideMerge(
        ProviderSessionDirectoryLive.pipe(Layer.provide(ProviderSessionRuntimeRepositoryLive)),
      ),
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
    const deliveryRepository = await runtime.runPromise(
      Effect.service(OrchestrationEventDeliveryRepository),
    );
    const queuedTurnPromotionRepository = await runtime.runPromise(
      Effect.service(QueuedTurnPromotionRepository),
    );
    const managedAttachments = await runtime.runPromise(
      Effect.service(ManagedAttachmentRepository),
    );
    const runtimeEventRepository = await runtime.runPromise(
      Effect.service(ProviderRuntimeEventRepository),
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
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    return {
      engine,
      handoffTransitions: Option.getOrUndefined(
        await runtime.runPromise(Effect.serviceOption(HandoffTransitions)),
      ),
      reactor,
      startSession,
      startSessionWithOutcome,
      listSessions,
      sendTurn,
      steerTurn,
      interruptTurn,
      rollbackConversation,
      isGitRepository,
      restoreScopedCheckpoint,
      stopSession,
      stopRuntimeSession,
      clearSessionResumeCursor,
      generateTitle,
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
      readThread: (threadId: ThreadId) =>
        runtime.runPromise(
          Effect.flatMap(Effect.service(ProjectionSnapshotQuery), (snapshot) =>
            snapshot.getThreadDetailById(threadId).pipe(Effect.map(Option.getOrUndefined)),
          ),
        ),
      seedUserMessage: (message: Parameters<typeof seedUserMessage>[0]) =>
        runtime.runPromise(seedUserMessage(message)),
      drain,
      emitRuntimeEvent,
      setRuntimeSessionTurnState,
      startReactor,
      deliveryRepository,
      runtimeEventRepository,
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
    await harness.seedUserMessage({
      threadId: ThreadId.makeUnsafe("thread-1"),
      messageId: input.messageId,
      text: "rollback target",
      createdAt: input.createdAt,
    });
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
    return harness.readThread(threadId);
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
        runtimeMode: "approval-required",
        createdAt: input.createdAt,
      }),
    );
  }

  async function closeReactorScope() {
    const activeScope = scope;
    expect(activeScope).not.toBeNull();
    await Effect.runPromise(Scope.close(activeScope!, Exit.void));
    scope = null;
  }

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
  return {
    createHarness,
    seedRollbackTarget,
    readHarnessThread,
    dispatchHarnessUserTurn,
    closeReactorScope,
    seedQueuedTurnBehindLiveTurn,
  };
}
