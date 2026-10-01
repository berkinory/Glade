import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ThreadGitMetadataReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  readonly drain: Effect.Effect<void>;
}

export class ThreadGitMetadataReactor extends ServiceMap.Service<
  ThreadGitMetadataReactor,
  ThreadGitMetadataReactorShape
>()("glade/orchestration/Services/ThreadGitMetadataReactor") {}
