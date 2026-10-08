import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";

import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import { ServerConfig } from "../../server/config.ts";
import { OrchestrationEngineLive } from "../Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";

type StoredEvent =
  ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
    ? A
    : never;

export function now() {
  return new Date().toISOString();
}

export async function createOrchestrationSystem(overrides?: {
  readonly eventStore?: OrchestrationEventStoreShape;
  readonly projectionPipeline?: OrchestrationProjectionPipelineShape;
}) {
  const runtime = ManagedRuntime.make(
    OrchestrationEngineLive.pipe(
      Layer.provide(
        overrides?.projectionPipeline
          ? Layer.succeed(OrchestrationProjectionPipeline, overrides.projectionPipeline)
          : OrchestrationProjectionPipelineLive,
      ),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(
        overrides?.eventStore
          ? Layer.succeed(OrchestrationEventStore, overrides.eventStore)
          : OrchestrationEventStoreLive,
      ),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "glade-orchestration-engine-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const managedAttachmentRepository = await runtime.runPromise(
    Effect.service(ManagedAttachmentRepository),
  );
  return {
    engine,
    managedAttachmentRepository,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

type OrchestrationSystem = Awaited<ReturnType<typeof createOrchestrationSystem>>;

// A non-transactional store: appends survive later projection failures, unlike SQLite.
export function makeInMemoryEventStore(options?: {
  readonly failFirstAppendFor?: string;
}): OrchestrationEventStoreShape {
  const events: StoredEvent[] = [];
  let failPending = options?.failFirstAppendFor !== undefined;
  return {
    append(event) {
      if (failPending && event.commandId === options?.failFirstAppendFor) {
        failPending = false;
        return Effect.fail(
          new PersistenceSqlError({ operation: "test.append", detail: "append failed" }),
        );
      }
      const savedEvent = { ...event, sequence: events.length + 1 } as StoredEvent;
      events.push(savedEvent);
      return Effect.succeed(savedEvent);
    },
    getHighWaterSequence: () => Effect.succeed(events.at(-1)?.sequence ?? 0),
    getThreadHighWaterSequence: (threadId) =>
      Effect.succeed(
        events.findLast(
          (event) => event.aggregateKind === "thread" && event.aggregateId === threadId,
        )?.sequence ?? 0,
      ),
    getThreadTitleHighWaterSequence: () => Effect.succeed(0),
    readThreadEvents: (input) =>
      Effect.succeed(
        events
          .filter(
            (event) =>
              event.aggregateKind === "thread" &&
              event.aggregateId === input.threadId &&
              event.sequence <= input.throughSequenceInclusive &&
              event.sequence < (input.beforeSequenceExclusive ?? Number.MAX_SAFE_INTEGER) &&
              (input.eventTypes === undefined || input.eventTypes.includes(event.type)),
          )
          .toSorted((left, right) => right.sequence - left.sequence)
          .slice(0, input.limit),
      ),
    readThreadEventsFromSequence: (
      threadId,
      sequenceExclusive,
      limit = 1_000,
      throughSequenceInclusive = Number.MAX_SAFE_INTEGER,
      eventTypes,
    ) =>
      Stream.fromIterable(
        events
          .filter(
            (event) =>
              event.aggregateKind === "thread" &&
              event.aggregateId === threadId &&
              event.sequence > sequenceExclusive &&
              event.sequence <= throughSequenceInclusive &&
              (eventTypes === undefined || eventTypes.includes(event.type)),
          )
          .slice(0, limit),
      ),
    readFromSequence: (sequenceExclusive) =>
      Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive)),
    readAll: () => Stream.fromIterable(events),
  };
}

export function stubProjectionPipeline(
  overrides: Partial<OrchestrationProjectionPipelineShape> = {},
): OrchestrationProjectionPipelineShape {
  return {
    bootstrap: Effect.void,
    projectMetadataEvent: () => Effect.void,
    projectEvent: () => Effect.void,
    projectHotEventInCurrentTransaction: () =>
      Effect.succeed({ deferredPhaseSettled: false, afterCommit: Effect.void }),
    projectDeferredEvent: () => Effect.void,
    ...overrides,
  };
}

export const projectionFailure = (operation: string) =>
  new PersistenceSqlError({ operation, detail: `${operation} failed` });

export function createProjectCommand(input: {
  readonly projectId: string;
  readonly createdAt: string;
  readonly commandId?: string;
  readonly workspaceRoot?: string;
}): Extract<OrchestrationCommand, { type: "project.create" }> {
  return {
    type: "project.create",
    commandId: CommandId.makeUnsafe(input.commandId ?? `cmd-create-${input.projectId}`),
    projectId: ProjectId.makeUnsafe(input.projectId),
    title: input.projectId,
    workspaceRoot: input.workspaceRoot ?? `/tmp/${input.projectId}`,
    defaultModelSelection: null,
    createdAt: input.createdAt,
  };
}

export function createThreadCommand(input: {
  readonly threadId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly commandId?: string;
  readonly title?: string;
  readonly runtimeMode?: "approval-required" | "full-access";
}): Extract<OrchestrationCommand, { type: "thread.create" }> {
  return {
    type: "thread.create",
    commandId: CommandId.makeUnsafe(input.commandId ?? `cmd-create-${input.threadId}`),
    threadId: ThreadId.makeUnsafe(input.threadId),
    projectId: ProjectId.makeUnsafe(input.projectId),
    title: input.title ?? input.threadId,
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: input.runtimeMode ?? "approval-required",
    branch: null,
    worktreePath: null,
    createdAt: input.createdAt,
  };
}

export async function seedProjectAndThread(
  system: Pick<OrchestrationSystem, "engine" | "run">,
  input: {
    readonly projectId: string;
    readonly threadId: string;
    readonly createdAt: string;
    readonly title?: string;
    readonly runtimeMode?: "approval-required" | "full-access";
  },
) {
  await system.run(system.engine.dispatch(createProjectCommand(input)));
  await system.run(system.engine.dispatch(createThreadCommand(input)));
}

export const readAllEvents = (system: Pick<OrchestrationSystem, "engine" | "run">) =>
  system.run(
    Stream.runCollect(system.engine.readEvents(0)).pipe(
      Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
    ),
  );
