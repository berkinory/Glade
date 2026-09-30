import { Schema } from "effect";
import { NonNegativeInt, IsoDateTime, SpaceId, ProjectId, ThreadId } from "../core/baseSchemas";
import {
  OrchestrationSpace,
  OrchestrationProject,
  OrchestrationThread,
  OrchestrationSpaceShell,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
} from "./threadEntities";
import { OrchestrationEvent } from "./events";

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  spaces: Schema.Array(OrchestrationSpace),
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});

export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  requiresEmptyProjectShellRepair: Schema.optional(Schema.Boolean),
  spaces: Schema.Array(OrchestrationSpaceShell),
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});

export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("space-upserted"),
    sequence: NonNegativeInt,
    space: OrchestrationSpaceShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("space-removed"),
    sequence: NonNegativeInt,
    spaceId: SpaceId,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    kind: Schema.Literal("space-order-updated"),
    sequence: NonNegativeInt,
    orderedSpaceIds: Schema.Array(SpaceId),
  }),
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);

export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);

export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});

export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);

export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;
