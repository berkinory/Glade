import { Schema } from "effect";
import {
  NonNegativeInt,
  IsoDateTime,
  MessageId,
  SpaceId,
  ProjectId,
  ThreadId,
} from "../core/baseSchemas";
import {
  OrchestrationSpace,
  OrchestrationProject,
  OrchestrationThread,
  OrchestrationSpaceShell,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  OrchestrationSession,
  OrchestrationLatestTurn,
  OrchestrationPendingInteraction,
} from "./threadEntities";
import { OrchestrationEvent } from "./events";

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  persistenceScope: Schema.optional(Schema.String),
  spaces: Schema.Array(OrchestrationSpace),
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});

export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  persistenceScope: Schema.optional(Schema.String),
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

// The parts of a thread detail a client compares with its live projection to decide whether it must
// read the full detail again. Read in one transaction, so every field reflects `snapshotSequence`.
export const OrchestrationThreadDetailHead = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  // The last thread-detail event of this thread at or below `snapshotSequence`. A client cursor below
  // it has missed events.
  detailSequence: NonNegativeInt,
  session: Schema.NullOr(OrchestrationSession),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  // A turn can name its final assistant message before that message is stored.
  latestTurnAssistantMessageStored: Schema.Boolean,
  // Stored messages and activities of the latest turn. A client holding fewer lost one of their events,
  // which no sequence comparison can show because later events moved its cursor past the gap.
  latestTurnMessageCount: NonNegativeInt,
  latestTurnActivityCount: NonNegativeInt,
  streamingMessageIds: Schema.Array(MessageId),
  pendingInteractions: Schema.Array(OrchestrationPendingInteraction),
});

export type OrchestrationThreadDetailHead = typeof OrchestrationThreadDetailHead.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
  // A cursor-resume gap in one item, so the client applies the catch-up as one store update instead of
  // rendering each intermediate state. Sent only to subscribers that ask with `batchReplay`.
  Schema.Struct({
    kind: Schema.Literal("replay"),
    events: Schema.Array(OrchestrationEvent),
  }),
]);

export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;
