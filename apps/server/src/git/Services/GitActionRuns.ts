import type { GitActionProgressEvent, GitRunStackedActionInput } from "@glade/contracts/git/git";
import { ServiceMap } from "effect";
import type { Stream } from "effect";

import type { ManagedAttachmentPrincipal } from "../../attachments/managedAttachmentPrincipal";
import type { GitActionRunError, GitManagerServiceError } from "../Errors.ts";

export interface GitActionRunsShape {
  /**
   * Starts a stacked action, or reattaches to it by action ID. The server owns the run, so
   * dropping the returned stream neither cancels nor repeats the mutation.
   */
  readonly attach: (
    input: GitRunStackedActionInput,
    owner: ManagedAttachmentPrincipal,
  ) => Stream.Stream<GitActionProgressEvent, GitActionRunError | GitManagerServiceError>;
}

export class GitActionRuns extends ServiceMap.Service<GitActionRuns, GitActionRunsShape>()(
  "glade/git/Services/GitActionRuns",
) {}
