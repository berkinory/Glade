import { type ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import { Effect, Option } from "effect";
import { toPersistenceSqlOrDecodeError } from "../../persistence/Errors.ts";
import { type OrchestrationProject } from "@glade/contracts/orchestration/threadEntities";
import { makeSnapshotThreadQueries } from "./snapshotThreadQueries";
import { decodeProjectionProjectOption } from "./snapshotDecoding";
import { toProjectedProjectShell, toProjectedSpaceShell } from "./snapshotAssembly";

export function makeSnapshotProjectLookup(input: {
  readonly getActiveProjectRowByWorkspaceRoot: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getActiveProjectRowByWorkspaceRoot"];
  readonly getProjectRowById: ReturnType<typeof makeSnapshotThreadQueries>["getProjectRowById"];
  readonly getSpaceRowById: ReturnType<typeof makeSnapshotThreadQueries>["getSpaceRowById"];
  readonly getFirstActiveThreadIdByProject: ReturnType<
    typeof makeSnapshotThreadQueries
  >["getFirstActiveThreadIdByProject"];
}) {
  const {
    getActiveProjectRowByWorkspaceRoot,
    getProjectRowById,
    getSpaceRowById,
    getFirstActiveThreadIdByProject,
  } = input;
  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.flatMap((option) =>
          decodeProjectionProjectOption(
            option,
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeModelSelection",
          ),
        ),
        Effect.map((option) =>
          Option.map(
            option,
            (row): OrchestrationProject => ({
              id: row.projectId,
              kind: row.kind,
              title: row.title,
              workspaceRoot: row.workspaceRoot,
              defaultModelSelection: row.defaultModelSelection,
              scripts: row.scripts,
              isPinned: row.isPinned > 0,
              spaceId: row.spaceId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }),
          ),
        ),
      );

  const getProjectShellById: ProjectionSnapshotQueryShape["getProjectShellById"] = (projectId) =>
    getProjectRowById({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getProjectShellById:query",
          "ProjectionSnapshotQuery.getProjectShellById:decodeRow",
        ),
      ),
      Effect.flatMap((option) =>
        decodeProjectionProjectOption(
          option,
          "ProjectionSnapshotQuery.getProjectShellById:decodeModelSelection",
        ),
      ),
      Effect.map((option) => Option.map(option, (row) => toProjectedProjectShell(row))),
    );

  const getSpaceShellById: ProjectionSnapshotQueryShape["getSpaceShellById"] = (spaceId) =>
    getSpaceRowById({ spaceId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getSpaceShellById:query",
          "ProjectionSnapshotQuery.getSpaceShellById:decodeRow",
        ),
      ),
      Effect.map(Option.map(toProjectedSpaceShell)),
    );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstActiveThreadIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.threadId)),
      );
  return {
    getActiveProjectByWorkspaceRoot,
    getProjectShellById,
    getSpaceShellById,
    getFirstActiveThreadIdByProjectId,
  };
}
