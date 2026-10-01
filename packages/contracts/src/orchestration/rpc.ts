import { PreviewWorkspaceRestoreInput, WorkspaceRestorePreview } from "./workspaceRestore";
import { Schema, Struct } from "effect";
import {
  NonNegativeInt,
  ThreadId,
  EventId,
  IsoDateTime,
  PositiveInt,
  TrimmedNonEmptyString,
} from "../core/baseSchemas";
import {
  ListProjectImportsInput,
  ListProjectImportsResult,
  ImportProjectInput,
  ImportProjectResult,
} from "../workspace/projectImport";
import {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
} from "./snapshots";
import { TurnCountRange, ThreadTurnDiff } from "./threadEntities";
import { OrchestrationEvent } from "./events";
import { ClientOrchestrationCommand } from "./commands";

export const ORCHESTRATION_WS_METHODS = {
  getSnapshot: "orchestration.getSnapshot",
  getShellSnapshot: "orchestration.getShellSnapshot",
  getThreadDetailSnapshot: "orchestration.getThreadDetailSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  prepareHandoff: "orchestration.prepareHandoff",
  importThread: "orchestration.importThread",
  listProjectImports: "orchestration.listProjectImports",
  importProject: "orchestration.importProject",
  repairState: "orchestration.repairState",
  getTurnDiff: "orchestration.getTurnDiff",
  previewWorkspaceRestore: "orchestration.previewWorkspaceRestore",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  listProviderDeliveryBlockers: "orchestration.listProviderDeliveryBlockers",
  reconcileProviderDelivery: "orchestration.reconcileProviderDelivery",
  prepareQuitResume: "orchestration.prepareQuitResume",
  subscribeShell: "orchestration.subscribeShell",
  unsubscribeShell: "orchestration.unsubscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  unsubscribeThread: "orchestration.unsubscribeThread",
} as const;

export const ORCHESTRATION_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
  shellEvent: "orchestration.shellEvent",
  threadEvent: "orchestration.threadEvent",
} as const;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);

export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});

export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetSnapshotInput = Schema.Struct({});

export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type;

const OrchestrationGetSnapshotResult = OrchestrationReadModel;

export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type;

export const OrchestrationGetShellSnapshotInput = Schema.Struct({});

export type OrchestrationGetShellSnapshotInput = typeof OrchestrationGetShellSnapshotInput.Type;

const OrchestrationGetShellSnapshotResult = OrchestrationShellSnapshot;

export type OrchestrationGetShellSnapshotResult = typeof OrchestrationGetShellSnapshotResult.Type;

export const OrchestrationRepairStateInput = Schema.Struct({});

export type OrchestrationRepairStateInput = typeof OrchestrationRepairStateInput.Type;

const OrchestrationRepairStateResult = OrchestrationReadModel;

export type OrchestrationRepairStateResult = typeof OrchestrationRepairStateResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optional(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);

export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;

export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optional(Schema.Boolean),
});

export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;

export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
  threadId: Schema.optional(ThreadId),
});

export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);

export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const ProviderDeliveryReconciliationOutcome = Schema.Literals([
  "accepted",
  "safe_retry",
  "abandon",
]);

export type ProviderDeliveryReconciliationOutcome =
  typeof ProviderDeliveryReconciliationOutcome.Type;

export const ProviderDeliveryBlockingEvidence = Schema.Struct({
  consumerName: Schema.String,
  eventSequence: NonNegativeInt,
  eventId: EventId,
  eventType: Schema.String,
  occurredAt: IsoDateTime,
  threadId: ThreadId,
  state: Schema.Literals(["dead", "uncertain"]),
  attemptCount: NonNegativeInt,
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
  lastReconciliationOutcome: Schema.NullOr(ProviderDeliveryReconciliationOutcome),
  lastReconciledAt: Schema.NullOr(IsoDateTime),
  lastReconciledBy: Schema.NullOr(Schema.String),
  lastReconciliationNote: Schema.NullOr(Schema.String),
});

export type ProviderDeliveryBlockingEvidence = typeof ProviderDeliveryBlockingEvidence.Type;

export const OrchestrationListProviderDeliveryBlockersInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  limit: Schema.optional(PositiveInt),
});

export type OrchestrationListProviderDeliveryBlockersInput =
  typeof OrchestrationListProviderDeliveryBlockersInput.Type;

export const OrchestrationListProviderDeliveryBlockersResult = Schema.Array(
  ProviderDeliveryBlockingEvidence,
);

export type OrchestrationListProviderDeliveryBlockersResult =
  typeof OrchestrationListProviderDeliveryBlockersResult.Type;

export const OrchestrationReconcileProviderDeliveryInput = Schema.Struct({
  eventSequence: NonNegativeInt,
  threadId: ThreadId,
  expectedState: Schema.Literals(["dead", "uncertain"]),
  outcome: ProviderDeliveryReconciliationOutcome,
  note: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
});

export type OrchestrationReconcileProviderDeliveryInput =
  typeof OrchestrationReconcileProviderDeliveryInput.Type;

export const OrchestrationReconcileProviderDeliveryResult = Schema.Struct({
  eventSequence: NonNegativeInt,
  threadId: ThreadId,
  outcome: ProviderDeliveryReconciliationOutcome,
  state: Schema.Literals(["retry", "succeeded", "dead", "uncertain"]),
  reconciledAt: IsoDateTime,
});

export type OrchestrationReconcileProviderDeliveryResult =
  typeof OrchestrationReconcileProviderDeliveryResult.Type;

export const QUIT_RESUME_MAX_THREADS = 256;

export const QUIT_RESUME_MAX_PROMPT_CHARS = 2_000;

export const OrchestrationPrepareQuitResumeInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(QUIT_RESUME_MAX_THREADS),
  ),

  continuationPrompt: TrimmedNonEmptyString.check(Schema.isMaxLength(QUIT_RESUME_MAX_PROMPT_CHARS)),
});

export type OrchestrationPrepareQuitResumeInput = typeof OrchestrationPrepareQuitResumeInput.Type;

export const OrchestrationPrepareQuitResumeResult = Schema.Struct({
  recordedThreadIds: Schema.Array(ThreadId),
  recordedAt: IsoDateTime,
});

export type OrchestrationPrepareQuitResumeResult = typeof OrchestrationPrepareQuitResumeResult.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({});

export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationUnsubscribeShellInput = Schema.Struct({});

export type OrchestrationUnsubscribeShellInput = typeof OrchestrationUnsubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,

  afterSequence: Schema.optional(NonNegativeInt),
});

export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationGetThreadDetailSnapshotInput = Schema.Struct({
  threadId: ThreadId,
});

export type OrchestrationGetThreadDetailSnapshotInput =
  typeof OrchestrationGetThreadDetailSnapshotInput.Type;

export const OrchestrationGetThreadDetailSnapshotResult = Schema.NullOr(
  OrchestrationThreadDetailSnapshot,
);

export type OrchestrationGetThreadDetailSnapshotResult =
  typeof OrchestrationGetThreadDetailSnapshotResult.Type;

export const OrchestrationImportThreadInput = Schema.Struct({
  threadId: ThreadId,
  externalId: TrimmedNonEmptyString,
});

export type OrchestrationImportThreadInput = typeof OrchestrationImportThreadInput.Type;

export const OrchestrationImportThreadResult = Schema.Struct({
  threadId: ThreadId,
});

export type OrchestrationImportThreadResult = typeof OrchestrationImportThreadResult.Type;

export const OrchestrationUnsubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});

export type OrchestrationUnsubscribeThreadInput = typeof OrchestrationUnsubscribeThreadInput.Type;

export const OrchestrationRpcSchemas = {
  prepareHandoff: { input: Schema.Struct({ threadId: ThreadId }), output: Schema.Void },
  previewWorkspaceRestore: { input: PreviewWorkspaceRestoreInput, output: WorkspaceRestorePreview },
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  getShellSnapshot: {
    input: OrchestrationGetShellSnapshotInput,
    output: OrchestrationGetShellSnapshotResult,
  },
  getThreadDetailSnapshot: {
    input: OrchestrationGetThreadDetailSnapshotInput,
    output: OrchestrationGetThreadDetailSnapshotResult,
  },
  repairState: {
    input: OrchestrationRepairStateInput,
    output: OrchestrationRepairStateResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  importThread: {
    input: OrchestrationImportThreadInput,
    output: OrchestrationImportThreadResult,
  },
  listProjectImports: { input: ListProjectImportsInput, output: ListProjectImportsResult },
  importProject: { input: ImportProjectInput, output: ImportProjectResult },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  listProviderDeliveryBlockers: {
    input: OrchestrationListProviderDeliveryBlockersInput,
    output: OrchestrationListProviderDeliveryBlockersResult,
  },
  reconcileProviderDelivery: {
    input: OrchestrationReconcileProviderDeliveryInput,
    output: OrchestrationReconcileProviderDeliveryResult,
  },
  prepareQuitResume: {
    input: OrchestrationPrepareQuitResumeInput,
    output: OrchestrationPrepareQuitResumeResult,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: Schema.Void,
  },
  unsubscribeShell: {
    input: OrchestrationUnsubscribeShellInput,
    output: Schema.Void,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: Schema.Void,
  },
  unsubscribeThread: {
    input: OrchestrationUnsubscribeThreadInput,
    output: Schema.Void,
  },
} as const;
