import {
  ProjectId,
  ThreadId,
  TurnId,
  MessageId,
  EventId,
  CheckpointRef,
} from "@glade/contracts/core/baseSchemas";
import { it } from "@effect/vitest";
import { OrchestrationProjectionSnapshotQueryLive } from "../Layers/ProjectionSnapshotQuery.ts";
import { Layer } from "effect";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);

export const asEventId = (value: string): EventId => EventId.makeUnsafe(value);

export const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

export const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);
