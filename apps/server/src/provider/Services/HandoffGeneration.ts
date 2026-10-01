import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { HandoffRecord } from "@glade/contracts/orchestration/threadEntities";
import { Effect, ServiceMap } from "effect";
import type { ProviderValidationError } from "../core/Errors";

export interface HandoffGenerationInput {
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly providerOptions: ProviderStartOptions;
}

export class HandoffGeneration extends ServiceMap.Service<
  HandoffGeneration,
  {
    readonly generate: (input: HandoffGenerationInput) => Effect.Effect<
      {
        readonly record: HandoffRecord;
        readonly inputTokens: number | null;
        readonly outputTokens: number | null;
      },
      ProviderValidationError
    >;
  }
>()("glade/provider/Services/HandoffGeneration") {}
