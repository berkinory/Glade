import type { ServiceMap } from "effect";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionSpaceRepository } from "../../persistence/Services/ProjectionSpaces.ts";
import { applyProjectMetadataProjection } from "../projectMetadataProjection.ts";
import { Effect } from "effect";
import { applySpaceMetadataProjection } from "../spaceMetadataProjection.ts";
import { type ShellMetadataOrchestrationEvent } from "../Services/ProjectionPipeline.ts";
import { ProjectorDefinition } from "./projectorRegistration";

export function makeMetadataProjectors(input: {
  readonly projectionProjectRepository: ServiceMap.Service.Shape<
    typeof ProjectionProjectRepository
  >;
  readonly projectionSpaceRepository: ServiceMap.Service.Shape<typeof ProjectionSpaceRepository>;
}) {
  const { projectionProjectRepository, projectionSpaceRepository } = input;
  const applyProjectsProjection: ProjectorDefinition["apply"] = (event, _attachmentSideEffects) => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
      case "project.deleted":
        return applyProjectMetadataProjection({ event, projectionProjectRepository }).pipe(
          Effect.asVoid,
        );
      case "space.created":
      case "space.meta-updated":
      case "space.order-updated":
        return applySpaceMetadataProjection({ event, projectionSpaceRepository }).pipe(
          Effect.asVoid,
        );
      case "space.deleted":
        return applySpaceMetadataProjection({ event, projectionSpaceRepository }).pipe(
          Effect.andThen(
            projectionProjectRepository.clearSpaceAssignments({
              spaceId: event.payload.spaceId,
              updatedAt: event.payload.deletedAt,
            }),
          ),
          Effect.asVoid,
        );
      default:
        return Effect.void;
    }
  };

  const applyShellMetadataProjection = (event: ShellMetadataOrchestrationEvent) => {
    switch (event.type) {
      case "space.created":
      case "space.meta-updated":
      case "space.order-updated":
        return applySpaceMetadataProjection({ event, projectionSpaceRepository });
      case "space.deleted":
        return applySpaceMetadataProjection({ event, projectionSpaceRepository }).pipe(
          Effect.andThen(
            projectionProjectRepository.clearSpaceAssignments({
              spaceId: event.payload.spaceId,
              updatedAt: event.payload.deletedAt,
            }),
          ),
        );
      case "project.created":
      case "project.meta-updated":
      case "project.deleted":
        return applyProjectMetadataProjection({ event, projectionProjectRepository });
    }
  };
  return { applyProjectsProjection, applyShellMetadataProjection };
}
