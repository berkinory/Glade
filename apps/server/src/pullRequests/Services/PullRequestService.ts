import type { TaggedFailure } from "../../platform/operationError.ts";
import type {
  PullRequestActionInput,
  PullRequestActionResult,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestDiffResult,
} from "@glade/contracts/git/pullRequests";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface PullRequestServiceShape {
  readonly detail: (
    input: PullRequestDetailInput,
  ) => Effect.Effect<PullRequestDetail, TaggedFailure>;
  readonly diff: (
    input: PullRequestDetailInput,
  ) => Effect.Effect<PullRequestDiffResult, TaggedFailure>;
  readonly action: (
    input: PullRequestActionInput,
  ) => Effect.Effect<PullRequestActionResult, TaggedFailure>;
  readonly comment: (
    input: PullRequestCommentInput,
  ) => Effect.Effect<PullRequestActionResult, TaggedFailure>;
}

export class PullRequestService extends ServiceMap.Service<
  PullRequestService,
  PullRequestServiceShape
>()("glade/pullRequests/Services/PullRequestService/PullRequestService") {}
