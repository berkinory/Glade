import type { PullRequestMergeCapabilities, PullRequestMergeMethod } from "@glade/contracts";

export function isPullRequestMergeMethodAllowed(
  capabilities: PullRequestMergeCapabilities,
  method: PullRequestMergeMethod,
): boolean {
  return capabilities[method];
}
