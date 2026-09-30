import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
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
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@glade/contracts/provider/sessionPolicy";
import { Effect, Exit, Layer, ManagedRuntime, Option, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderRuntimeEventRepositoryLive } from "../../persistence/Layers/ProviderRuntimeEvents.ts";
import {
  PROVIDER_RUNTIME_INGESTION_CONSUMER,
  ProviderRuntimeEventRepository,
  type PersistedProviderRuntimeEvent,
} from "../../persistence/Services/ProviderRuntimeEvents.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import {
  ProviderRuntimeIngestionLive,
  selectProviderRuntimeJournalStream,
} from "./ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ComputerManager } from "../../computer/ComputerManager.ts";

import { ComputerService } from "../../computer/Services/ComputerService.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../server/config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

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
    forkThread: () => Effect.succeed(null),
    interruptTurn: () => unsupported(),
    stopTask: () => unsupported(),
    backgroundTask: () => unsupported(),
    steerSubagent: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: (provider) =>
      Effect.succeed({
        supportsLiveTurnDiffPatch: provider === "codex",
      }),
    rollbackConversation: () => unsupported(),
    compactThread: () => unsupported(),
    closeRuntimeEvents: Effect.void,
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

async function waitForThread(
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

function emitPendingUserInputRequest(
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

const pendingInteractionStatus = (
  thread: OrchestrationThread | undefined,
  requestId: string,
): string | undefined =>
  thread?.pendingInteractions?.find((row) => row.requestId === requestId)?.status;

const userInputFailureActivities = (thread: OrchestrationThread | undefined) =>
  thread?.activities.filter((activity) => activity.kind === "provider.user-input.respond.failed") ??
  [];

async function waitForProjectedThread(
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

type ProviderRuntimeTestReadModel = OrchestrationReadModel;
type ProviderRuntimeTestThread = ProviderRuntimeTestReadModel["threads"][number];
type ProviderRuntimeTestMessage = ProviderRuntimeTestThread["messages"][number];
type ProviderRuntimeTestProposedPlan = ProviderRuntimeTestThread["proposedPlans"][number];
type ProviderRuntimeTestActivity = ProviderRuntimeTestThread["activities"][number];

describe("ProviderRuntimeIngestion", () => {
  it("uses an already-persisted runtime stream without appending the event again", async () => {
    const event: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-already-persisted-stream"),
      provider: "codex",
      createdAt: "2026-08-07T00:00:00.000Z",
      threadId: asThreadId("thread-1"),
      payload: { message: "already durable" },
    };
    const persisted = { sequence: 42, event };
    let appendCalls = 0;

    const selected = await Effect.runPromise(
      Stream.runCollect(
        selectProviderRuntimeJournalStream({
          streamEvents: Stream.succeed(event),
          streamPersistedEvents: Stream.succeed(persisted),
          append: (candidate) =>
            Effect.sync(() => {
              appendCalls += 1;
              return { sequence: 43, event: candidate };
            }),
        }),
      ).pipe(Effect.map((events) => Array.from(events))),
    );

    expect(selected).toEqual([persisted]);
    expect(appendCalls).toBe(0);
  });

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
    readonly computerManager?: ComputerManager;
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
      Layer.provideMerge(
        options?.computerManager
          ? Layer.succeed(ComputerService, {
              supported: true,
              availability: { kind: "available", backend: "test" },
              manager: options.computerManager,
            })
          : Layer.empty,
      ),
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
        projectId: asProjectId("project-1"),
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
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
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
      readProjectedThread,
    };
  }

  it("REL-01C gate: replays output persisted before subscription without duplicate acceptance", async () => {
    const harness = await createHarness({ startIngestion: false });
    const event: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-runtime-journal-before-subscribe"),
      provider: "codex",
      createdAt: "2026-07-14T00:00:00.000Z",
      threadId: asThreadId("thread-1"),
      payload: {
        message: "Recovered durable provider output",
      },
    };

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(
          `provider:${event.eventId}:thread-activity-append:thread-1:${event.eventId}`,
        ),
        threadId: asThreadId("thread-1"),
        activity: {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary: "Runtime warning",
          payload: {
            message: "Recovered durable provider output",
            detail: "Recovered durable provider output",
          },
          turnId: null,
        },
        createdAt: event.createdAt,
      }),
    );
    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(event));

    await harness.startIngestion();
    await waitForThread(harness.engine, (thread) =>
      thread.activities.some((activity) => activity.id === event.eventId),
    );
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(persisted.sequence);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const recoveredActivities = readModel.threads
      .find((thread) => thread.id === asThreadId("thread-1"))
      ?.activities.filter((activity) => activity.id === event.eventId);
    expect(recoveredActivities).toHaveLength(1);
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(persisted.sequence);
  });

  it("quarantines a previously rejected command without blocking later assistant output", async () => {
    const harness = await createHarness({ startIngestion: false });
    const threadId = asThreadId("thread-1");
    const lateThreadId = asThreadId("thread-2");
    const turnId = asTurnId("turn-after-rejected-command");
    const itemId = asItemId("assistant-after-rejected-command");
    const rejectedEvent: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-previously-rejected"),
      provider: "codex",
      createdAt: "2026-07-14T00:00:00.000Z",
      threadId: lateThreadId,
      payload: { message: "Warning for a rejected command" },
    };
    const rejectedCommandId = CommandId.makeUnsafe(
      `provider:${rejectedEvent.eventId}:thread-activity-append:${lateThreadId}:runtime.warning:${rejectedEvent.eventId}`,
    );

    // Model a durable rejection: the exact command this event replays into was already rejected by an
    // invariant (thread-2 did not exist yet when it was first dispatched), so every replay raises
    // PreviouslyRejected — retrying the journal row can never succeed.
    await expect(
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.activity.append",
          commandId: rejectedCommandId,
          threadId: lateThreadId,
          activity: {
            id: rejectedEvent.eventId,
            createdAt: rejectedEvent.createdAt,
            tone: "info",
            kind: "runtime.warning",
            summary: "Runtime warning",
            payload: {
              message: "Warning for a rejected command",
              detail: "Warning for a rejected command",
            },
            turnId: null,
          },
          createdAt: rejectedEvent.createdAt,
        }),
      ),
    ).rejects.toThrow();

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-2-create"),
        threadId: lateThreadId,
        projectId: asProjectId("project-1"),
        title: "Late thread",
        modelSelection: {
          provider: "codex",
          model: "cursor-default",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const rejectedRow = await Effect.runPromise(
      harness.runtimeEventRepository.append(rejectedEvent),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "turn.started",
        eventId: asEventId("evt-turn-started-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:00.500Z",
        threadId,
        turnId,
        payload: {},
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "content.delta",
        eventId: asEventId("evt-assistant-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:01.000Z",
        threadId,
        turnId,
        itemId,
        payload: {
          streamKind: "assistant_text",
          delta: "The journal kept moving.",
        },
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-assistant-complete-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:02.000Z",
        threadId,
        turnId,
        itemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    const terminalRow = await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "turn.completed",
        eventId: asEventId("evt-turn-complete-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:03.000Z",
        threadId,
        turnId,
        payload: { state: "completed" },
      }),
    );

    await harness.startIngestion();
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === `assistant:${itemId}` &&
          message.text === "The journal kept moving." &&
          message.streaming === false,
      ),
    );
    expect(thread.messages.find((message) => message.id === `assistant:${itemId}`)?.text).toBe(
      "The journal kept moving.",
    );
    expect(thread.latestTurn).toMatchObject({ turnId, state: "completed" });
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(terminalRow.sequence);
    expect(rejectedRow.sequence).toBeLessThan(terminalRow.sequence);
  });

  it("REL-01C gate: rebuilds accepted buffered output before a terminal event", async () => {
    const harness = await createHarness({ startIngestion: false });
    const turnId = asTurnId("turn-buffered-restart");
    const itemId = asItemId("item-buffered-restart");
    const bufferedEvent: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: asEventId("evt-buffered-before-restart"),
      provider: "codex",
      createdAt: "2026-07-14T00:01:00.000Z",
      threadId: asThreadId("thread-1"),
      turnId,
      itemId,
      payload: {
        streamKind: "assistant_text",
        delta: "buffered before restart",
      },
    };
    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(bufferedEvent));
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: persisted.sequence,
          updatedAt: "2026-07-14T00:01:01.000Z",
        }),
      ),
    ).toBe(true);

    await harness.startIngestion();
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-buffered-after-restart-complete"),
        provider: "codex",
        createdAt: "2026-07-14T00:01:02.000Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:item-buffered-restart" &&
          message.text === "buffered before restart" &&
          message.streaming === false,
      ),
    );
    expect(
      thread.messages.find((message) => message.id === "assistant:item-buffered-restart")?.text,
    ).toBe("buffered before restart");
  });

  it("marks streamed assistant text segments at tool-intervention boundaries", async () => {
    const harness = await createHarness();
    const turnId = asTurnId("turn-segment-interleave");
    const itemId = asItemId("item-segment-interleave");
    const threadId = asThreadId("thread-1");
    const push = (event: ProviderRuntimeEvent) =>
      Effect.runPromise(harness.runtimeEventRepository.append(event));
    const eventId = (suffix: string) => asEventId(`evt-segment-${suffix}`);

    await push({
      type: "content.delta",
      eventId: eventId("1"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:00.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Plan: " },
    });
    await push({
      type: "content.delta",
      eventId: eventId("2"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "scan files." },
    });

    const toolItemId = asItemId("tool-segment-interleave");
    await push({
      type: "item.started",
      eventId: eventId("3"),
      provider: "codex",

      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId: toolItemId,
      payload: { itemType: "command_execution", status: "inProgress", title: "fd" },
    });
    await push({
      type: "content.delta",
      eventId: eventId("4"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Found the file: " },
    });
    await push({
      type: "content.delta",
      eventId: eventId("5"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:21.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "a.test.ts" },
    });
    await push({
      type: "item.completed",
      eventId: eventId("6"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:30.000Z",
      threadId,
      turnId,
      itemId: toolItemId,
      payload: { itemType: "command_execution", status: "completed", title: "fd" },
    });
    await push({
      type: "content.delta",
      eventId: eventId("7"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:40.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Done." },
    });
    await push({
      type: "item.completed",
      eventId: eventId("8"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:45.000Z",
      threadId,
      turnId,
      itemId,
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:item-segment-interleave" && message.streaming === false,
      ),
    );
    const message = thread.messages.find(
      (entry) => entry.id === "assistant:item-segment-interleave",
    );
    const toolStarted = thread.activities.find((activity) => activity.kind === "tool.started");
    expect(message?.text).toBe("Plan: scan files.Found the file: a.test.tsDone.");
    expect(
      message?.textSegments?.map(({ startedAt, endedAt, text }) => ({
        startedAt,
        endedAt,
        text,
      })),
    ).toEqual([
      {
        startedAt: "2026-07-14T00:10:00.000Z",

        endedAt: "2026-07-14T00:10:01.000Z",
        text: "Plan: scan files.",
      },
      {
        startedAt: "2026-07-14T00:10:01.000Z",
        endedAt: "2026-07-14T00:10:21.000Z",
        text: "Found the file: a.test.ts",
      },
      {
        startedAt: "2026-07-14T00:10:40.000Z",

        endedAt: "2026-07-14T00:10:45.000Z",
        text: "Done.",
      },
    ]);
    expect(message?.textSegments?.[0]?.sequence).toBeLessThan(toolStarted?.sequence ?? -1);
    expect(toolStarted?.sequence).toBeLessThan(message?.textSegments?.[1]?.sequence ?? -1);
  });

  it("clears active turn state when a provider session reports ready", async () => {
    const harness = await createHarness();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-before-ready"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-ready-clears"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-ready-clears",
    );

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-ready-clears-turn"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-ready-clears"),
      payload: {
        state: "ready",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "ready" && entry.session?.activeTurnId === null,
    );
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.activeTurnId).toBeNull();
  });

  it("settles a pending user-input request when its turn ends without a session restart", async () => {
    const harness = await createHarness();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-interrupted-user-input"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted"),
    });
    emitPendingUserInputRequest(harness, {
      eventId: "evt-user-input-requested-interrupted",
      requestId: "req-interrupted-user-input",
      turnId: "turn-interrupted",
      lifecycleGeneration: "generation-interrupted",
    });

    const pendingThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === true,
    );
    expect(pendingInteractionStatus(pendingThread, "req-interrupted-user-input")).toBe("pending");

    // A Stop rotates the lifecycle generation without emitting `session.started`, so the interrupted
    // turn's terminal event is the only settlement signal left.
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-interrupted-user-input"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted"),
      payload: { state: "interrupted" },
    });

    const settledThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === false,
    );
    expect(pendingInteractionStatus(settledThread, "req-interrupted-user-input")).toBe("uncertain");
    const failures = userInputFailureActivities(settledThread);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({
      requestId: "req-interrupted-user-input",
      lifecycleGeneration: "generation-interrupted",
      detail: expect.stringContaining(
        "Stale pending user-input request: req-interrupted-user-input",
      ),
    });
  });

  it("keeps a Claude background approval answerable after foreground completion", async () => {
    const harness = await createHarness();
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("claude-foreground");
    const requestId = ApprovalRequestId.makeUnsafe("claude-background-approval");
    const common = {
      provider: "claudeAgent" as const,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
      lifecycleGeneration: "claude-generation",
    };
    harness.emit({
      ...common,
      type: "turn.started",
      eventId: asEventId("claude-started"),
      payload: {},
    });
    harness.emit({
      ...common,
      type: "request.opened",
      eventId: asEventId("claude-approval-opened"),
      requestId,
      payload: { requestType: "tool_approval", detail: "Background computer operation" },
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => pendingInteractionStatus(thread, requestId) === "pending",
    );
    harness.emit({
      ...common,
      type: "turn.completed",
      eventId: asEventId("claude-foreground-ended"),
      payload: { state: "completed" },
    });
    await harness.drain();
    const pending = await harness.readProjectedThread();
    expect(pendingInteractionStatus(pending, requestId)).toBe("pending");

    harness.emit({
      ...common,
      type: "request.resolved",
      eventId: asEventId("claude-approval-resolved"),
      requestId,
      payload: { requestType: "tool_approval", decision: "accept" },
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingApprovals === false,
    );
  });

  it("scopes session.exited settlement to the exited lifecycle generation", async () => {
    const harness = await createHarness();

    emitPendingUserInputRequest(harness, {
      eventId: "evt-user-input-requested-exit-generation",
      requestId: "req-exit-generation-a",
      turnId: "turn-exit-generation-a",
      lifecycleGeneration: "generation-a",
    });
    await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => thread.hasPendingUserInput === true,
    );

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-other-generation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      lifecycleGeneration: "generation-b",
      payload: { reason: "exit from a different generation" },
    });
    await harness.drain();
    const untouchedThread = await harness.readProjectedThread();
    expect(pendingInteractionStatus(untouchedThread, "req-exit-generation-a")).toBe("pending");
    expect(userInputFailureActivities(untouchedThread)).toHaveLength(0);

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-matching-generation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      lifecycleGeneration: "generation-a",
      payload: { reason: "exit from the owning generation" },
    });

    const settledThread = await waitForProjectedThread(
      harness.readProjectedThread,
      (thread) => pendingInteractionStatus(thread, "req-exit-generation-a") === "uncertain",
    );
    expect(settledThread.hasPendingUserInput).toBe(false);
    expect(userInputFailureActivities(settledThread)).toHaveLength(1);
  });

  it("does not re-emit message-sent events when the same image_generation completion replays", async () => {
    const harness = await createHarness();
    const turnId = asTurnId("turn-image-replay");
    const imagePath = "/tmp/provider-thread/replay.png";

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-replay-turn-started"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-replay-answer-delta"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("answer-replay"),
      payload: { streamKind: "assistant_text", delta: "Here you go." },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-replay-answer-complete"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("answer-replay"),
      payload: { itemType: "assistant_message", status: "completed" },
    });

    await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message) =>
          message.id === "assistant:answer-replay" &&
          message.text.includes("Here you go.") &&
          message.streaming === false,
      ),
    );

    const imageEvent = {
      type: "item.completed" as const,
      eventId: asEventId("evt-replay-image-complete"),
      provider: "codex" as const,
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("call-replay"),
      payload: {
        itemType: "image_generation",
        status: "completed",
        title: "Generated image",
        detail: imagePath,
        data: { kind: "codex.generated_image", path: imagePath, callId: "call-replay" },
      },
    };

    harness.emit(imageEvent);
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-replay-turn-completed"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      payload: { state: "completed" },
    });

    await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:answer-replay" &&
          message.text.includes(`![Generated image](${imagePath})`),
      ),
    );

    const eventCountBeforeReplay = await Effect.runPromise(
      harness.engine.getReadModel().pipe(
        Effect.map((readModel) => {
          const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
          const message = thread?.messages.find((entry) => entry.id === "assistant:answer-replay");
          return message?.text ?? "";
        }),
      ),
    );

    // Replay the same image_generation_end event with a fresh eventId (provider would use a new id even
    // for an idempotent replay). The dedup guard should prevent any further delta or complete
    // dispatches because the target message already references the image.
    harness.emit({
      ...imageEvent,
      eventId: asEventId("evt-replay-image-complete-2"),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalText = await Effect.runPromise(
      harness.engine.getReadModel().pipe(
        Effect.map((readModel) => {
          const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
          const message = thread?.messages.find((entry) => entry.id === "assistant:answer-replay");
          return message?.text ?? "";
        }),
      ),
    );

    expect(finalText).toBe(eventCountBeforeReplay);
    const occurrences = finalText.split(`![Generated image](${imagePath})`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("buffers Codex summary deltas into one completed reasoning activity", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const baseEvent = {
      provider: "codex" as const,
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-reasoning"),
      itemId: asItemId("reasoning-buffered-1"),
    };

    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-1"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 0,
        delta: "**Inspect",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-2"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 0,
        delta: " the protocol**\n\n<!-- -->",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-3"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 1,
        delta: "**Update the adapter**\n\n<!-- -->",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "item.completed",
      eventId: asEventId("evt-buffered-reasoning-completed"),
      payload: {
        itemType: "reasoning",
        status: "completed",
        title: "Reasoning",
      },
    });

    const stableActivityId = "provider-reasoning:thread-1:reasoning-buffered-1";
    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.id === stableActivityId,
      ),
    );
    const reasoningActivities = thread.activities.filter(
      (activity: ProviderRuntimeTestActivity) => activity.id === stableActivityId,
    );

    expect(reasoningActivities).toHaveLength(1);
    expect(reasoningActivities[0]).toMatchObject({
      kind: "task.progress",
      tone: "tool",
      summary: "Reasoning trace",
      payload: {
        status: "completed",
        detail: "**Inspect the protocol**\n\n<!-- -->\n\n**Update the adapter**\n\n<!-- -->",
        data: { toolCallId: "reasoning-buffered-1" },
      },
    });
  });

  it("finalizes buffered proposed-plan deltas into a first-class proposed plan on turn completion", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-plan-buffer"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-plan-buffer",
    );

    harness.emit({
      type: "turn.proposed.delta",
      eventId: asEventId("evt-plan-delta-1"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        delta: "## Buffered plan\n\n- first",
      },
    });
    harness.emit({
      type: "turn.proposed.delta",
      eventId: asEventId("evt-plan-delta-2"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        delta: "\n- second",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-plan-buffer"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        state: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.proposedPlans.some(
        (proposedPlan: ProviderRuntimeTestProposedPlan) =>
          proposedPlan.id === "plan:thread-1:turn:turn-plan-buffer",
      ),
    );
    const proposedPlan = thread.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) =>
        entry.id === "plan:thread-1:turn:turn-plan-buffer",
    );
    expect(proposedPlan?.planMarkdown).toBe("## Buffered plan\n\n- first\n- second");
  });

  it("binds overlapping same-thread delivery modes in provider turn order", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-same-thread-buffered"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-same-thread-buffered"),
          role: "user",
          text: "buffer first",
          attachments: [],
        },
        assistantDeliveryMode: "buffered",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-same-thread-streaming"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-same-thread-streaming"),
          role: "user",
          text: "stream second",
          attachments: [],
        },
        assistantDeliveryMode: "streaming",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
    });
    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-same-thread-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-streaming"),
    });
    await harness.drain();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
      itemId: asItemId("item-same-thread-buffered"),
      payload: { streamKind: "assistant_text", delta: "first stays hidden" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-same-thread-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-streaming"),
      itemId: asItemId("item-same-thread-streaming"),
      payload: { streamKind: "assistant_text", delta: "second is live" },
    });
    await harness.drain();

    const liveThread = await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-streaming" &&
          message.streaming &&
          message.text === "second is live",
      ),
    );
    expect(
      liveThread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-completed-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
      itemId: asItemId("item-same-thread-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-buffered" &&
          !message.streaming &&
          message.text === "first stays hidden",
      ),
    );
  });

  it("isolates overlapping buffered and streaming turns across threads", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const secondThreadId = asThreadId("thread-delivery-buffered");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-delivery-buffered"),
        threadId: secondThreadId,
        projectId: asProjectId("project-1"),
        title: "Buffered Thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-seed-delivery-buffered"),
        threadId: secondThreadId,
        session: {
          threadId: secondThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: now,
          lastError: null,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-overlap-streaming"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-overlap-streaming"),
          role: "user",
          text: "stream this turn",
          attachments: [],
        },
        assistantDeliveryMode: "streaming",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-overlap-buffered"),
        threadId: secondThreadId,
        message: {
          messageId: asMessageId("message-overlap-buffered"),
          role: "user",
          text: "buffer this turn",
          attachments: [],
        },
        assistantDeliveryMode: "buffered",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
    });
    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
    });
    await harness.drain();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
      itemId: asItemId("item-overlap-streaming"),
      payload: { streamKind: "assistant_text", delta: "visible immediately" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-overlap-buffered"),
      payload: { streamKind: "assistant_text", delta: "hidden until complete" },
    });
    await harness.drain();

    const streamingThread = await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-overlap-streaming" &&
            message.streaming &&
            message.text === "visible immediately",
        ),
      2_000,
      asThreadId("thread-1"),
    );
    expect(
      streamingThread.messages.find(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-streaming",
      )?.streaming,
    ).toBe(true);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const bufferedThread = readModel.threads.find((thread) => thread.id === secondThreadId);
    expect(
      bufferedThread?.messages.some(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-overlap-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });

    const completedBufferedThread = await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-overlap-buffered" &&
            !message.streaming &&
            message.text === "hidden until complete",
        ),
      2_000,
      secondThreadId,
    );
    expect(
      completedBufferedThread.messages.find(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-buffered",
      )?.streaming,
    ).toBe(false);

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      payload: { state: "completed" },
    });
    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session.activeTurnId === null,
      2_000,
      secondThreadId,
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-late-delta-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-late-overlap-buffered"),
      payload: { streamKind: "assistant_text", delta: "late but still buffered" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-second-delta-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
      itemId: asItemId("item-second-overlap-streaming"),
      payload: { streamKind: "assistant_text", delta: "still streams" },
    });
    await harness.drain();

    const afterTerminalReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const afterTerminalBufferedThread = afterTerminalReadModel.threads.find(
      (thread) => thread.id === secondThreadId,
    );
    expect(
      afterTerminalBufferedThread?.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-late-overlap-buffered",
      ),
    ).toBe(false);
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-second-overlap-streaming" &&
            message.streaming &&
            message.text === "still streams",
        ),
      2_000,
      asThreadId("thread-1"),
    );

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-late-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-late-overlap-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-late-overlap-buffered" &&
            !message.streaming &&
            message.text === "late but still buffered",
        ),
      2_000,
      secondThreadId,
    );
  });

  it("flushes buffered assistant text before session exit clears turn state", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-session-exit"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-buffered-session-exit",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-session-exit"),
      itemId: asItemId("item-buffered-session-exit"),
      payload: {
        streamKind: "assistant_text",
        delta: "persist me before exit",
      },
    });
    await harness.drain();

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffered-session-exit" &&
          message.text === "persist me before exit" &&
          message.streaming === false,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffered-session-exit",
    );
    expect(message?.text).toBe("persist me before exit");
    expect(message?.streaming).toBe(false);
  });

  it("spills oversized buffered deltas and still finalizes full assistant text", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const oversizedText = "x".repeat(40_000);

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-buffer-spill",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        streamKind: "assistant_text",
        delta: oversizedText,
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffer-spill" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffer-spill",
    );
    expect(message?.text.length).toBe(oversizedText.length);
    expect(message?.text).toBe(oversizedText);
    expect(message?.streaming).toBe(false);
    expect(message?.textSegments).toBeUndefined();
  });

  it("does not duplicate assistant completion when item.completed is followed by turn.completed", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-complete-dedup",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        streamKind: "assistant_text",
        delta: "done",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      payload: {
        state: "completed",
      },
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "ready" &&
        thread.session?.activeTurnId === null &&
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-complete-dedup" && !message.streaming,
        ),
    );

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const completionEvents = events.filter((event) => {
      if (event.type !== "thread.message-sent") {
        return false;
      }
      return (
        event.payload.messageId === "assistant:item-complete-dedup" &&
        event.payload.streaming === false
      );
    });
    expect(completionEvents).toHaveLength(1);
    const completionEvent = completionEvents[0] as
      | Extract<OrchestrationEvent, { type: "thread.message-sent" }>
      | undefined;
    expect(completionEvent?.payload.text).toBe("done");
  });

  it("keeps buffered command output when completed raw streams are empty", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-empty-stream-buffered-output"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-empty-stream-output"),
      itemId: asItemId("item-empty-stream-output"),
      payload: {
        streamKind: "command_output",
        delta: "captured through delta\n",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-empty-stream-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-empty-stream-output"),
      itemId: asItemId("item-empty-stream-output"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Ran command",
        detail: "printf buffered",
        data: {
          rawInput: { command: "printf buffered" },
          rawOutput: {
            stdout: "",
            stderr: "",
          },
        },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-empty-stream-completed"),
    );
    const activity = thread.activities.find((entry) => entry.id === "evt-empty-stream-completed");
    const payload =
      activity?.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : {};
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const rawOutput =
      data.rawOutput && typeof data.rawOutput === "object"
        ? (data.rawOutput as Record<string, unknown>)
        : {};

    expect(rawOutput).toMatchObject({
      stdout: "",
      stderr: "",
      output: "captured through delta\n",
    });
  });

  it("creates and routes subagent runtime events into child threads", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "item.updated",
      eventId: asEventId("evt-collab-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-parent"),
      itemId: asItemId("item-collab"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-1"],
            receiverAgents: [
              {
                threadId: "child-provider-1",
                agentNickname: "Locke",
                agentRole: "explorer",
                agentId: "agent-1",
              },
            ],
          },
        },
      },
    });

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-child-turn-started"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-child"),
      parentTurnId: asTurnId("turn-parent"),
      providerRefs: {
        providerThreadId: "child-provider-1",
        providerParentThreadId: "parent-provider-1",
        providerTurnId: "turn-child",
        parentProviderTurnId: "turn-parent",
      },
      payload: {},
    });

    const childThread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.parentThreadId === "thread-1" &&
        entry.subagentNickname === "Locke" &&
        entry.subagentRole === "explorer" &&
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-child",
      2000,
      asThreadId("subagent:thread-1:child-provider-1"),
    );

    expect(childThread.title).toBe("Locke [explorer]");
    expect(childThread.creationSource).toBe("provider_native");
    expect(childThread.sourceThreadId).toBe("thread-1");
    expect(childThread.sourceTurnId).toBe("turn-parent");

    const parentThread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) =>
          activity.id === "evt-collab-updated" && activity.kind === "tool.updated",
      ),
    );
    expect(
      parentThread.activities.some((activity) => activity.id === "evt-child-turn-started"),
    ).toBe(false);
  });

  it("keeps ingesting after a subagent child thread is deleted instead of re-creating it", async () => {
    const harness = await createHarness();
    const childThreadId = asThreadId("subagent:thread-1:child-provider-deleted");
    const collabEvent = {
      type: "item.updated",
      provider: "codex",
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-deleted-child"),
      itemId: asItemId("item-collab-deleted"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-deleted"],
          },
        },
      },
    } as const;

    harness.emit({
      ...collabEvent,
      eventId: asEventId("evt-collab-deleted-child-1"),
      createdAt: new Date().toISOString(),
    });
    await harness.drain();
    await waitForThread(
      harness.engine,
      (entry) => entry.parentThreadId === "thread-1",
      2000,
      childThreadId,
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-delete-native-child"),
        threadId: childThreadId,
      }),
    );

    // A later provider event for the same child must not try to resurrect the tombstoned thread:
    // `thread.create` would be rejected, and the rejection is stored against a deterministic command
    // id, so every later replay of this event would fail on the stored rejection.
    harness.emit({
      ...collabEvent,
      eventId: asEventId("evt-collab-deleted-child-2"),
      createdAt: new Date().toISOString(),
    });
    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const child = readModel.threads.find((thread) => thread.id === childThreadId);
    expect(child?.deletedAt).not.toBeNull();

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-after-deleted-child"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      payload: { message: "still ingesting" },
    });
    await harness.drain();
    const parent = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.id === "evt-after-deleted-child",
      ),
    );
    expect(parent.id).toBe("thread-1");
  });

  it("starts when an accepted open-turn row can no longer replay its stored command", async () => {
    const harness = await createHarness({ startIngestion: false });
    const eventId = asEventId("evt-open-turn-unreplayable");
    const turnId = asTurnId("turn-open-turn-unreplayable");
    const bufferedItemId = asItemId("item-after-unreplayable-open-turn");
    const event: ProviderRuntimeEvent = {
      type: "item.updated",
      eventId,
      provider: "codex",
      createdAt: "2026-07-14T00:03:00.000Z",
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("item-collab-unreplayable"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-unreplayable"],
          },
        },
      },
    };

    // Bind the child-create command id to a rejected command, the way a build that reshaped provider
    // command ids leaves receipts the next build can never reuse. The startup rebuild runs on the
    // server's boot path, so a row it can never replay must degrade to a warning, not a crash loop.
    const rejected = await Effect.runPromise(
      Effect.result(
        harness.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(
            `provider:${eventId}:subagent-thread-create:subagent:thread-1:child-provider-unreplayable`,
          ),
          threadId: asThreadId("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Duplicate",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: event.createdAt,
        }),
      ),
    );
    expect(rejected._tag).toBe("Failure");

    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(event));
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: persisted.sequence,
          updatedAt: event.createdAt,
        }),
      ),
    ).toBe(true);

    const bufferedRow = await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "content.delta",
        eventId: asEventId("evt-buffered-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:00.500Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId: bufferedItemId,
        payload: {
          streamKind: "assistant_text",
          delta: "Replay continued after the failed event.",
        },
      }),
    );
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: bufferedRow.sequence,
          updatedAt: "2026-07-14T00:03:00.500Z",
        }),
      ),
    ).toBe(true);

    await harness.startIngestion();

    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-complete-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:01.000Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId: bufferedItemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "runtime.warning",
        eventId: asEventId("evt-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:02.000Z",
        threadId: asThreadId("thread-1"),
        payload: { message: "still ingesting" },
      }),
    );
    await harness.drain();
    const parent = await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) =>
            activity.id === "evt-after-unreplayable-open-turn",
        ) &&
        entry.messages.some(
          (message) =>
            message.id === `assistant:${bufferedItemId}` &&
            message.text === "Replay continued after the failed event.",
        ),
    );
    expect(parent.id).toBe("thread-1");
  });

  it("caps native child materialization per parent turn and deduplicates replay", async () => {
    const harness = await createHarness();
    const receiverThreadIds = Array.from({ length: 22 }, (_, index) => `native-child-${index}`);
    const event = {
      type: "item.updated",
      eventId: asEventId("evt-collab-overflow"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-native-budget"),
      itemId: asItemId("item-collab-overflow"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds,
          },
        },
      },
    } as const;

    harness.emit(event);
    await harness.drain();
    harness.emit(event);
    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const nativeChildren = readModel.threads.filter(
      (thread) =>
        thread.parentThreadId === "thread-1" && thread.sourceTurnId === "turn-native-budget",
    );
    expect(nativeChildren).toHaveLength(20);
    expect(
      nativeChildren.every(
        (thread) =>
          thread.creationSource === "provider_native" &&
          thread.sourceThreadId === "thread-1" &&
          thread.gatewayOperationId === null,
      ),
    ).toBe(true);
    const parent = readModel.threads.find((thread) => thread.id === "thread-1");
    expect(
      parent?.activities.filter((activity) => activity.kind === "subagent.materialization.capped"),
    ).toHaveLength(1);
  });

  it("continues processing runtime events after a single event handler failure", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-invalid-delta"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-invalid"),
      itemId: asItemId("item-invalid"),
      payload: {
        streamKind: "assistant_text",
        delta: undefined,
      },
    } as unknown as ProviderRuntimeEvent);

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-after-failure"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-after-failure"),
      payload: {
        message: "runtime still processed",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-after-failure" &&
        entry.session?.lastError === "runtime still processed",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime still processed");
  });

  it("acknowledges a burst of live journal notifications in pages, not one per event", async () => {
    const harness = await createHarness({ persistedStream: true });
    const sql = await runtime!.runPromise(Effect.service(SqlClient.SqlClient));
    await Effect.runPromise(
      sql`CREATE TABLE cursor_acks (from_sequence INTEGER, to_sequence INTEGER)`,
    );
    await Effect.runPromise(sql`
      CREATE TRIGGER capture_cursor_acks AFTER UPDATE ON provider_runtime_event_consumers
      BEGIN
        INSERT INTO cursor_acks VALUES (OLD.last_acked_sequence, NEW.last_acked_sequence);
      END
    `);
    const rows: PersistedProviderRuntimeEvent[] = [];
    for (let index = 0; index < 32; index += 1) {
      rows.push(
        await Effect.runPromise(
          harness.runtimeEventRepository.append({
            type: "runtime.warning",
            eventId: asEventId(`live-burst-${index}`),
            provider: "codex",
            threadId: asThreadId("thread-1"),
            createdAt: "2026-09-10T00:00:00.000Z",
            payload: { message: "burst" },
          }),
        ),
      );
    }

    for (const row of rows) harness.emitPersisted(row);
    const target = rows.at(-1)!.sequence;
    const deadline = Date.now() + 5_000;
    while (
      (await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      )) < target
    ) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the live drain");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const acks = await Effect.runPromise(
      sql<{ readonly fromSequence: number; readonly toSequence: number }>`
        SELECT from_sequence AS "fromSequence", to_sequence AS "toSequence" FROM cursor_acks
        ORDER BY to_sequence ASC
      `,
    );
    expect(acks.at(-1)?.toSequence).toBe(target);

    expect(acks.length).toBeLessThan(rows.length);
    expect(acks.length).toBeLessThanOrEqual(4);
  });
});
