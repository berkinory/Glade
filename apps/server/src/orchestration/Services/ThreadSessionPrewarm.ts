import type { OrchestrationPrewarmThreadSessionInput } from "@glade/contracts/orchestration/rpc";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ThreadSessionPrewarmShape {
  // Best effort: a thread that cannot be prewarmed is skipped, never reported as an error.
  readonly prewarm: (input: OrchestrationPrewarmThreadSessionInput) => Effect.Effect<void>;
}

export class ThreadSessionPrewarm extends ServiceMap.Service<
  ThreadSessionPrewarm,
  ThreadSessionPrewarmShape
>()("glade/orchestration/ThreadSessionPrewarm") {}
