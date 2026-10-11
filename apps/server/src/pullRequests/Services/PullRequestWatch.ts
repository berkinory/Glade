import type {
  GitPullRequestWatchInput,
  GitPullRequestWatchStatus,
} from "@glade/contracts/git/pullRequests";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect, type Scope } from "effect";

import type { GitHubError } from "../../git/Errors.ts";
import type { PersistenceSqlError, ProjectionRepositoryError } from "../../persistence/Errors.ts";

type PullRequestWatchError = GitHubError | PersistenceSqlError | ProjectionRepositoryError;

export interface PullRequestWatchShape {
  /** Runs the periodic sweep for the lifetime of the scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly setWatch: (
    input: GitPullRequestWatchInput,
  ) => Effect.Effect<void, PullRequestWatchError>;
  readonly status: (
    threadId: ThreadId,
  ) => Effect.Effect<GitPullRequestWatchStatus, PullRequestWatchError>;
}

export class PullRequestWatch extends ServiceMap.Service<PullRequestWatch, PullRequestWatchShape>()(
  "glade/pullRequests/Services/PullRequestWatch",
) {}
