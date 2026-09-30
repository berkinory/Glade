import type { OrchestrationEvent } from "@glade/contracts/orchestration/orchestration";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { ProjectMetadataOrchestrationEvent } from "../projectMetadataProjection.ts";
import type { SpaceMetadataOrchestrationEvent } from "../spaceMetadataProjection.ts";

export type ShellMetadataOrchestrationEvent =
  | ProjectMetadataOrchestrationEvent
  | SpaceMetadataOrchestrationEvent;

export interface OrchestrationProjectionPipelineShape {
  readonly bootstrap: Effect.Effect<void, ProjectionRepositoryError>;

  readonly projectEvent: (
    event: OrchestrationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // The caller must hold a transaction so hot projector writes commit atomically with its command.
  // Use projectEvent outside a transaction.
  readonly projectHotEventInCurrentTransaction: (event: OrchestrationEvent) => Effect.Effect<
    {
      // True when the deferred phase had no projector for this event and its cursor was advanced inside
      // the hot transaction, so the caller must not run a separate deferred pass for it.
      readonly deferredPhaseSettled: boolean;
    },
    ProjectionRepositoryError
  >;

  readonly projectDeferredEvent: (
    event: OrchestrationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly projectMetadataEvent: (
    event: ShellMetadataOrchestrationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class OrchestrationProjectionPipeline extends ServiceMap.Service<
  OrchestrationProjectionPipeline,
  OrchestrationProjectionPipelineShape
>()("glade/orchestration/Services/ProjectionPipeline/OrchestrationProjectionPipeline") {}
