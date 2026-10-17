import { ServiceMap } from "effect";
import type { Effect, Scope, Stream } from "effect";

// Continues a chat a temporary connection or provider error stopped, after a short wait.
export interface TransientFailureResumeShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  // Whether any chat is waiting to continue; that wait is agent work for keep-awake.
  readonly streamWaiting: Stream.Stream<boolean>;
}

export class TransientFailureResume extends ServiceMap.Service<
  TransientFailureResume,
  TransientFailureResumeShape
>()("glade/orchestration/Services/TransientFailureResume") {}
