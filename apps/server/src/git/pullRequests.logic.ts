import type {
  PullRequestMergeCapabilities,
  PullRequestMergeMethod,
} from "@glade/contracts/git/pullRequests";

export function isPullRequestMergeMethodAllowed(
  capabilities: PullRequestMergeCapabilities,
  method: PullRequestMergeMethod,
): boolean {
  return capabilities[method];
}
