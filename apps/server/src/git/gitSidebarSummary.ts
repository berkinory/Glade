import type { GitSidebarSummaryInput, GitSidebarSummaryResult } from "@glade/contracts/git/git";
import { Effect } from "effect";

import type { GitCoreShape } from "./Services/GitCore";
import type { GitHubCliShape } from "./Services/GitHubCli";
import { toResolvedPullRequest } from "./gitPullRequestSummary";

export function readGitSidebarSummary(
  input: GitSidebarSummaryInput,
  git: Pick<GitCoreShape, "summary">,
  github: Pick<GitHubCliShape, "listPullRequests">,
) {
  return Effect.all(
    {
      worktrees: Effect.forEach(
        [...new Set(input.worktreeCwds)],
        (cwd) => git.summary(cwd).pipe(Effect.map((summary) => ({ cwd, summary }))),
        { concurrency: 6 },
      ),
      pullRequests: github
        .listPullRequests({ cwd: input.cwd, limit: 1000, priority: "background" })
        .pipe(
          Effect.map((prs) =>
            prs.map((pr) => ({
              ...toResolvedPullRequest(pr),
              headRepository: pr.headRepositoryNameWithOwner ?? null,
            })),
          ),
          Effect.catch((error) =>
            Effect.logDebug("Sidebar pull request list unavailable", error).pipe(Effect.as(null)),
          ),
        ),
    },
    { concurrency: 2 },
  ).pipe(Effect.map((result) => result satisfies GitSidebarSummaryResult));
}
