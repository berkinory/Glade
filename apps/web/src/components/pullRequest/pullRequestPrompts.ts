import type {
  GitPullRequestCheck,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import { ensureNativeApi } from "~/nativeApi";

const LOGS_PER_PROMPT = 2;

export function buildReviewCommentsPrompt(
  number: number,
  comments: GitPullRequestReviewResult["comments"],
): string {
  const list = comments
    .map((comment) => {
      const location = comment.path
        ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}`
        : "";
      return `- ${comment.author}${location}: ${comment.body}`;
    })
    .join("\n");
  return `Address this review feedback on pull request #${number}:\n${list}\n\nMake the changes, run the relevant checks, and push.`;
}

export function buildConflictPrompt(number: number, baseBranch: string): string {
  return `Pull request #${number} has merge conflicts with ${baseBranch}. Rebase this branch onto the latest ${baseBranch}, resolve the conflicts, run the relevant checks, and push.`;
}

/** Includes the tail of each failing Actions job log, so the agent starts from the real error. */
export async function buildFailingChecksPrompt(
  cwd: string,
  number: number,
  checks: ReadonlyArray<GitPullRequestCheck>,
): Promise<string> {
  const failing = checks.filter((check) => check.state === "failure");
  const logs = new Map<string, string>();
  await Promise.all(
    failing
      .filter((check) => check.jobId !== null)
      .slice(0, LOGS_PER_PROMPT)
      .map(async (check) => {
        try {
          const log = await ensureNativeApi().git.pullRequestCheckLog({
            cwd,
            jobId: check.jobId ?? 0,
          });
          if (log.excerpt) logs.set(check.name, log.excerpt);
        } catch {
          // The prompt still names the check and its link when a log cannot be read.
        }
      }),
  );
  const sections = failing.map((check) => {
    const heading = `- ${check.name}${check.url ? ` (${check.url})` : ""}`;
    const log = logs.get(check.name);
    return log ? `${heading}\n\n\`\`\`\n${log}\n\`\`\`` : heading;
  });
  return `These checks are failing on pull request #${number}:\n${sections.join("\n")}\n\nInvestigate the failures, fix them, and push the fix.`;
}
