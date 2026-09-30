import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@glade/contracts/orchestration/orchestration";
import { ServiceMap } from "effect";
import type { Effect, Scope, Stream } from "effect";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type {
  OrchestrationEventStoreError,
  ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import type { ManagedAttachmentPrincipal } from "../../managedAttachmentPrincipal.ts";

interface OrchestrationDispatchContext {
  readonly attachmentPrincipal?: ManagedAttachmentPrincipal;
}

interface OrchestrationProjectionCatchUpStatus {
  readonly state: "healthy" | "degraded" | "unknown";
  readonly inFlight: boolean;
  readonly retryAttempts: number;
  readonly lastFailure: string | null;

  readonly highWaterSequence: number;

  readonly lagByProjector: Readonly<Record<string, number>>;

  readonly missingProjectors: ReadonlyArray<string>;
}

export interface OrchestrationEngineShape {
  readonly quiesce: Effect.Effect<void>;

  readonly drain: Effect.Effect<void>;

  readonly stop: Effect.Effect<void>;

  readonly getProjectionCatchUpStatus: Effect.Effect<OrchestrationProjectionCatchUpStatus>;

  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  readonly readEventsThrough: (
    fromSequenceExclusive: number,
    throughSequenceInclusive: number,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  readonly readThreadEvents: (
    threadId: string,
    fromSequenceExclusive: number,
    eventTypes?: ReadonlyArray<string>,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  readonly readThreadEventsThrough: (
    threadId: string,
    fromSequenceExclusive: number,
    throughSequenceInclusive: number,
    eventTypes?: ReadonlyArray<string>,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  readonly getEventHighWaterSequence: Effect.Effect<number, OrchestrationEventStoreError>;

  readonly getThreadTitleHighWaterSequence: (
    threadId: string,
  ) => Effect.Effect<number, OrchestrationEventStoreError>;

  readonly subscribeDomainEvents: Effect.Effect<
    Stream.Stream<OrchestrationEvent>,
    never,
    Scope.Scope
  >;

  readonly getReadModel: () => Effect.Effect<OrchestrationReadModel, never, never>;

  readonly dispatch: (
    command: OrchestrationCommand,
    context?: OrchestrationDispatchContext,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never>;

  // Repair project-facing projection state for older installs without clearing existing chat rows.
  // Replays the snapshot-related projector cursors and refreshes the in-memory command model from
  // projection state.
  readonly repairState: () => Effect.Effect<
    OrchestrationReadModel,
    OrchestrationDispatchError | OrchestrationEventStoreError,
    never
  >;

  readonly refreshCommandReadModel: () => Effect.Effect<
    OrchestrationReadModel,
    OrchestrationDispatchError | ProjectionRepositoryError,
    never
  >;

  readonly streamDomainEvents: Stream.Stream<OrchestrationEvent>;
}

export class OrchestrationEngineService extends ServiceMap.Service<
  OrchestrationEngineService,
  OrchestrationEngineShape
>()("glade/orchestration/Services/OrchestrationEngine/OrchestrationEngineService") {}
