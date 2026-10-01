import { IsoDateTime, ProjectId, SpaceId } from "@glade/contracts/core/baseSchemas";
import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { ProjectScript } from "@glade/contracts/orchestration/threadEntities";
import { ProjectKind } from "@glade/contracts/workspace/project";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProject = Schema.Struct({
  projectId: ProjectId,
  kind: ProjectKind.pipe(Schema.withDecodingDefault(() => "project")),
  title: Schema.String,
  workspaceRoot: Schema.String,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  isPinned: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  spaceId: Schema.NullOr(SpaceId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionProject = typeof ProjectionProject.Type;

export const GetProjectionProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type GetProjectionProjectInput = typeof GetProjectionProjectInput.Type;

export const DeleteProjectionProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type DeleteProjectionProjectInput = typeof DeleteProjectionProjectInput.Type;

export const ClearProjectionProjectSpaceAssignmentsInput = Schema.Struct({
  spaceId: SpaceId,
  updatedAt: IsoDateTime,
});
export type ClearProjectionProjectSpaceAssignmentsInput =
  typeof ClearProjectionProjectSpaceAssignmentsInput.Type;

export interface ProjectionProjectRepositoryShape {
  readonly upsert: (row: ProjectionProject) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionProjectInput,
  ) => Effect.Effect<Option.Option<ProjectionProject>, ProjectionRepositoryError>;

  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProject>,
    ProjectionRepositoryError
  >;

  readonly deleteById: (
    input: DeleteProjectionProjectInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly clearSpaceAssignments: (
    input: ClearProjectionProjectSpaceAssignmentsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionProjectRepository extends ServiceMap.Service<
  ProjectionProjectRepository,
  ProjectionProjectRepositoryShape
>()("glade/persistence/Services/ProjectionProjects/ProjectionProjectRepository") {}
