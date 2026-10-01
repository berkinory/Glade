import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import { Effect, ServiceMap } from "effect";
import type { ProviderValidationError } from "../../provider/core/Errors";

export class HandoffPreparation extends ServiceMap.Service<
  HandoffPreparation,
  {
    readonly prepare: (input: {
      readonly threadId: ThreadId;
      readonly modelSelection?: ModelSelection | undefined;
      readonly providerOptions?: ProviderStartOptions | undefined;
      readonly latestRequest?: string | undefined;
      readonly attachmentCount?: number | undefined;
    }) => Effect.Effect<string | null, ProviderValidationError>;
    readonly cancel: (threadId: ThreadId) => Effect.Effect<boolean, ProviderValidationError>;
  }
>()("glade/orchestration/Services/HandoffPreparation") {}
