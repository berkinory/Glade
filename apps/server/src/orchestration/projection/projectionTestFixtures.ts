import { ThreadId, MessageId, EventId, CommandId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option, Layer, FileSystem } from "effect";
import { ProjectionThreadMessageRepository } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { OrchestrationProjectionPipelineLive } from "../Layers/ProjectionPipeline.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ServerConfig } from "../../server/config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationEventReplayFilter,
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import { type OrchestrationProjectionPipelineShape } from "../Services/ProjectionPipeline.ts";

export const readProjectedMessage = (threadId: ThreadId, messageId: MessageId) =>
  Effect.gen(function* () {
    const repository = yield* ProjectionThreadMessageRepository;
    return Option.getOrThrow(yield* repository.getByThreadAndMessageId({ threadId, messageId }));
  }).pipe(Effect.provide(ProjectionThreadMessageRepositoryLive));

export const makeProjectionPipelinePrefixedTestLayer = (prefix: string) =>
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

export const makeObservedEventStoreLayer = (
  readCursors: Array<number>,
  readFilters: Array<OrchestrationEventReplayFilter> = [],
) =>
  Layer.effect(
    OrchestrationEventStore,
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      return {
        ...eventStore,
        readFromSequence(sequenceExclusive, limit, throughSequenceInclusive, filter) {
          readCursors.push(sequenceExclusive);
          if (filter) readFilters.push(filter);
          return eventStore.readFromSequence(
            sequenceExclusive,
            limit,
            throughSequenceInclusive,
            filter,
          );
        },
      } satisfies OrchestrationEventStoreShape;
    }),
  ).pipe(Layer.provide(OrchestrationEventStoreLive));

export const makeAppendAndProject =
  (
    eventStore: OrchestrationEventStoreShape,
    projectionPipeline: OrchestrationProjectionPipelineShape,
  ) =>
  (event: Parameters<OrchestrationEventStoreShape["append"]>[0]) =>
    eventStore
      .append(event)
      .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export const makeScenarioAppender = (
  appendAndProject: ReturnType<typeof makeAppendAndProject>,
  prefix: string,
) => {
  let scenarioSequence = 0;
  return (
    event: DistributiveOmit<
      Parameters<typeof appendAndProject>[0],
      "eventId" | "commandId" | "correlationId" | "causationEventId" | "metadata"
    >,
  ) =>
    appendAndProject({
      ...event,
      eventId: EventId.makeUnsafe(`evt-${prefix}-${++scenarioSequence}`),
      commandId: CommandId.makeUnsafe(`cmd-${prefix}-${scenarioSequence}`),
      correlationId: CommandId.makeUnsafe(`cmd-${prefix}-${scenarioSequence}`),
      causationEventId: null,
      metadata: {},
    });
};

export const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath));
    return fileInfo._tag === "Success";
  });

export const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer(
  "glade-projection-pipeline-test-",
);
