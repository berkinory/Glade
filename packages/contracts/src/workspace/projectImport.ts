import { OrchestrationMessage } from "../orchestration/threadEntities";
import { Schema } from "effect";
import {
  IsoDateTime,
  MessageId,
  PositiveInt,
  ProjectId,
  SpaceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../core/baseSchemas";

export const ProjectImportProvider = Schema.Literals(["codex", "claudeAgent"]);
export type ProjectImportProvider = typeof ProjectImportProvider.Type;

export const ProjectImportThread = Schema.Struct({
  key: TrimmedNonEmptyString,
  provider: ProjectImportProvider,
  title: Schema.String,
  cwd: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archived: Schema.Boolean,
  alreadyImported: Schema.Boolean,
});
export type ProjectImportThread = typeof ProjectImportThread.Type;

export const ProjectImportProject = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: Schema.String,
  workspaceRoot: Schema.String,
  directoryExists: Schema.Boolean,
  existingProjectId: Schema.NullOr(ProjectId),
  providers: Schema.Array(ProjectImportProvider),
  threads: Schema.Array(ProjectImportThread),
});
export type ProjectImportProject = typeof ProjectImportProject.Type;

export const ListProjectImportsInput = Schema.Struct({
  providers: Schema.Array(ProjectImportProvider),
});
export type ListProjectImportsInput = typeof ListProjectImportsInput.Type;

export const ListProjectImportsResult = Schema.Struct({
  projects: Schema.Array(ProjectImportProject),
  sources: Schema.Array(
    Schema.Struct({
      provider: ProjectImportProvider,
      error: Schema.NullOr(Schema.String),
    }),
  ),
});
export type ListProjectImportsResult = typeof ListProjectImportsResult.Type;

export const ImportProjectInput = Schema.Struct({
  projectKey: TrimmedNonEmptyString,
  threadKey: Schema.NullOr(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
});
export type ImportProjectInput = typeof ImportProjectInput.Type;

export const ImportProjectResult = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  status: Schema.Literals(["imported", "already-present", "project-linked"]),
});
export type ImportProjectResult = typeof ImportProjectResult.Type;

export const ReadImportedHistoryInput = Schema.Struct({
  threadId: ThreadId,
  beforeMessageId: MessageId,
  probe: Schema.optional(Schema.Boolean),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
});
export type ReadImportedHistoryInput = typeof ReadImportedHistoryInput.Type;
export const ReadImportedHistoryResult = Schema.Struct({
  messages: Schema.Array(OrchestrationMessage),
  nextCursor: Schema.NullOr(Schema.String),
});
export type ReadImportedHistoryResult = typeof ReadImportedHistoryResult.Type;
