import { IsoDateTime, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderSessionRuntimeStatus,
  RuntimeMode,
} from "@glade/contracts/orchestration/orchestration";
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
}

export class ProviderSessionRuntimeRepository extends ServiceMap.Service<
  ProviderSessionRuntimeRepository,
  ProviderSessionRuntimeRepositoryShape
>()("glade/persistence/Services/ProviderSessionRuntime/ProviderSessionRuntimeRepository") {}
