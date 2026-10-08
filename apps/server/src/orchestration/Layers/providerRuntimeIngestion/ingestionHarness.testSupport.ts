import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { Effect, Exit, Layer, ManagedRuntime, Option, PubSub, Scope, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach } from "vitest";

import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { ProviderRuntimeEventRepositoryLive } from "../../../persistence/Layers/ProviderRuntimeEvents.ts";
import {
  ProviderRuntimeEventRepository,
  type PersistedProviderRuntimeEvent,
} from "../../../persistence/Services/ProviderRuntimeEvents.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../../server/config.ts";
import { OrchestrationEngineLive } from "../OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionLive } from "../ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../Services/OrchestrationEngine.ts";
import { ProviderRuntimeIngestionService } from "../../Services/ProviderRuntimeIngestion.ts";
import { ProjectionSnapshotQuery } from "../../Services/ProjectionSnapshotQuery.ts";

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
export const asItemId = (value: string): RuntimeItemId => RuntimeItemId.makeUnsafe(value);
export const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

type ProviderRuntimeTestThread = OrchestrationReadModel["threads"][number];
export type ProviderRuntimeTestMessage = ProviderRuntimeTestThread["messages"][number];
export type ProviderRuntimeTestActivity = ProviderRuntimeTestThread["activities"][number];

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

function createProviderServiceHarness(options?: { readonly persistedStream?: boolean }) {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const persistedEventPubSub = Effect.runSync(PubSub.unbounded<PersistedProviderRuntimeEvent>());
  const runtimeSessions: ProviderSession[] = [];

  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    steerTurn: () => unsupported(),
    startReview: () => unsupported(),
    forkThread: () => unsupported(),
    interruptTurn: () => unsupported(),
    stopTask: () => unsupported(),
    backgroundTask: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    stopRuntimeSession: () => unsupported(),
    hasLiveRuntimeTasks: () => Effect.succeed(false),
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: (provider) =>
      Effect.succeed({
        supportsLiveTurnDiffPatch: provider === "codex",
      }),
    rollbackConversation: () => unsupported(),
    compactThread: () => unsupported(),
    updateNativeHistory: () => unsupported(),
    closeRuntimeEvents: Effect.void,
    getRuntimeEventPumpHealth: () => Effect.succeed([]),
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    // Only the already-persisted path uses this; when present the ingestion ignores `streamEvents`, so
    // ordinary harnesses must not provide it.
    ...(options?.persistedStream === true
      ? { streamPersistedEvents: Stream.fromPubSub(persistedEventPubSub) }
      : {}),
  };

  const setSession = (session: ProviderSession): void => {
    const existingIndex = runtimeSessions.findIndex((entry) => entry.threadId === session.threadId);
    if (existingIndex >= 0) {
      runtimeSessions[existingIndex] = session;
      return;
    }
    runtimeSessions.push(session);
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    const canonicalEvent = (() => {
      if (event.payload !== undefined) return event;
      const {
        type,
        eventId,
        provider,
        createdAt,
        threadId,
        turnId,
        itemId,
        requestId,
        ...legacyPayload
      } = event;
      const payload =
        type === "turn.completed" && legacyPayload.state === undefined
          ? { ...legacyPayload, state: legacyPayload.status }
          : legacyPayload;
      return {
        type,
        eventId,
        provider,
        createdAt,
        threadId,
        ...(turnId === undefined ? {} : { turnId }),
        ...(itemId === undefined ? {} : { itemId }),
        ...(requestId === undefined ? {} : { requestId }),
        payload,
      };
    })();
    Effect.runSync(
      PubSub.publish(runtimeEventPubSub, canonicalEvent as unknown as ProviderRuntimeEvent),
    );
  };

  const emitPersisted = (persisted: PersistedProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(persistedEventPubSub, persisted));
  };

  return {
    service,
    emit,
    emitPersisted,
    setSession,
  };
}

export async function waitForThread(
  engine: OrchestrationEngineShape,
  predicate: (thread: ProviderRuntimeTestThread) => boolean,
  timeoutMs = 2000,
  threadId: ThreadId = asThreadId("thread-1"),
) {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<ProviderRuntimeTestThread> => {
    const readModel = await Effect.runPromise(engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (thread && predicate(thread)) {
      return thread;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for thread state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };
  return poll();
}

export function emitPendingUserInputRequest(
  harness: { readonly emit: (event: LegacyProviderRuntimeEvent) => void },
  input: {
    readonly eventId: string;
    readonly requestId: string;
    readonly turnId: string;
    readonly lifecycleGeneration: string;
  },
): void {
  harness.emit({
    type: "user-input.requested",
    eventId: asEventId(input.eventId),
    provider: "codex",
    createdAt: new Date().toISOString(),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId(input.turnId),
    lifecycleGeneration: input.lifecycleGeneration,
    requestId: ApprovalRequestId.makeUnsafe(input.requestId),
    payload: {
      questions: [
        {
          id: "question-1",
          header: "Question",
          question: "Which option should be used?",
          options: [{ label: "one", description: "The first option" }],
        },
      ],
    },
  });
}

export const pendingInteractionStatus = (
  thread: OrchestrationThread | undefined,
  requestId: string,
): string | undefined =>
  thread?.pendingInteractions?.find((row) => row.requestId === requestId)?.status;

export const userInputFailureActivities = (thread: OrchestrationThread | undefined) =>
  thread?.activities.filter((activity) => activity.kind === "provider.user-input.respond.failed") ??
  [];

export async function waitForProjectedThread(
  read: () => Promise<OrchestrationThread | undefined>,
  predicate: (thread: OrchestrationThread) => boolean,
  timeoutMs = 2000,
): Promise<OrchestrationThread> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const thread = await read();
    if (thread && predicate(thread)) {
      return thread;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for projected thread state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function makeIngestionTestHarness() {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | ProviderRuntimeIngestionService
    | ProviderRuntimeEventRepository
    | SqlClient.SqlClient
    | ProjectionSnapshotQuery,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createHarness(options?: {
    readonly startIngestion?: boolean;
    readonly persistedStream?: boolean;
  }) {
    const workspaceRoot = makeTempDir("glade-provider-project-");
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    const provider = createProviderServiceHarness(
      options?.persistedStream === true ? { persistedStream: true } : undefined,
    );
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const runtimeEventRepositoryLayer = ProviderRuntimeEventRepositoryLive.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
    );
    const layer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(runtimeEventRepositoryLayer),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const ingestion = await runtime.runPromise(Effect.service(ProviderRuntimeIngestionService));
    const runtimeEventRepository = await runtime.runPromise(
      Effect.service(ProviderRuntimeEventRepository),
    );
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    scope = await Effect.runPromise(Scope.make("sequential"));
    let ingestionStarted = false;
    const startIngestion = async () => {
      if (ingestionStarted) return;
      ingestionStarted = true;
      await Effect.runPromise(ingestion.start.pipe(Scope.provide(scope!)));
    };
    if (options?.startIngestion !== false) {
      await startIngestion();
    }
    const drain = () => Effect.runPromise(ingestion.drain);

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-provider-project-create"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Provider Project",
        workspaceRoot,
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-seed"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    provider.setSession({
      provider: "codex",
      status: "ready",
      runtimeMode: "approval-required",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt,
      updatedAt: createdAt,
    });

    const readProjectedThread = async (
      threadId: ThreadId = ThreadId.makeUnsafe("thread-1"),
    ): Promise<OrchestrationThread | undefined> =>
      Option.getOrUndefined(await runtime!.runPromise(snapshotQuery.getThreadDetailById(threadId)));

    return {
      engine,
      emit: provider.emit,
      emitPersisted: provider.emitPersisted,
      setProviderSession: provider.setSession,
      drain,
      startIngestion,
      runtimeEventRepository,
      sql: await runtime.runPromise(Effect.service(SqlClient.SqlClient)),
      readProjectedThread,
    };
  }

  return createHarness;
}
