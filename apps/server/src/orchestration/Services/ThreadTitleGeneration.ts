import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";

export interface ThreadTitleGenerationInput {
  readonly threadId: ThreadId;
  readonly message: string;
  readonly modelSelection: ModelSelection;
  readonly providerOptions?: ProviderStartOptions | undefined;
}
import type { TextGenerationError } from "../../git/Errors";

export interface ThreadTitleGenerationShape {
  readonly generate: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<string, TextGenerationError>;
}

export class ThreadTitleGeneration extends ServiceMap.Service<
  ThreadTitleGeneration,
  ThreadTitleGenerationShape
>()("glade/orchestration/ThreadTitleGeneration") {}
