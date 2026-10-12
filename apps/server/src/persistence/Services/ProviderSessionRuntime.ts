import { IsoDateTime, ThreadId } from "@glade/contracts/core/baseSchemas";
import { ProviderSessionRuntimeStatus, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProviderSessionRuntimeRepositoryError } from "../Errors.ts";

export const ProviderSessionRuntime = Schema.Struct({
  threadId: ThreadId,
  providerName: Schema.String,
  adapterKey: Schema.String,
  runtimeMode: RuntimeMode,
  status: ProviderSessionRuntimeStatus,
  lifecycleGeneration: Schema.String,
  lastSeenAt: IsoDateTime,
  resumeCursor: Schema.NullOr(Schema.Unknown),
  runtimePayload: Schema.NullOr(Schema.Unknown),
});
export type ProviderSessionRuntime = typeof ProviderSessionRuntime.Type;

export const ParkedProviderSession = Schema.Struct({
  threadId: ThreadId,
  providerName: Schema.String,
  resumeCursor: Schema.Unknown,
  lastSeenMessageId: Schema.NullOr(Schema.String),
  parkedAt: IsoDateTime,
});
export type ParkedProviderSession = typeof ParkedProviderSession.Type;

const GetProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
type GetProviderSessionRuntimeInput = typeof GetProviderSessionRuntimeInput.Type;

const DeleteProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
type DeleteProviderSessionRuntimeInput = typeof DeleteProviderSessionRuntimeInput.Type;

export interface ProviderSessionRuntimeRepositoryShape {
  readonly upsert: (
    runtime: ProviderSessionRuntime,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  readonly getByThreadId: (
    input: GetProviderSessionRuntimeInput,
  ) => Effect.Effect<Option.Option<ProviderSessionRuntime>, ProviderSessionRuntimeRepositoryError>;

  readonly list: () => Effect.Effect<
    ReadonlyArray<ProviderSessionRuntime>,
    ProviderSessionRuntimeRepositoryError
  >;

  readonly deleteByThreadId: (
    input: DeleteProviderSessionRuntimeInput,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  readonly park: (
    session: ParkedProviderSession,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  readonly listParked: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<ReadonlyArray<ParkedProviderSession>, ProviderSessionRuntimeRepositoryError>;

  readonly deleteParked: (input: {
    readonly threadId: ThreadId;
    readonly providerName?: string;
  }) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;
}

export class ProviderSessionRuntimeRepository extends ServiceMap.Service<
  ProviderSessionRuntimeRepository,
  ProviderSessionRuntimeRepositoryShape
>()("glade/persistence/Services/ProviderSessionRuntime/ProviderSessionRuntimeRepository") {}
