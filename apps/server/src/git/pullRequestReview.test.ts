import { describe, expect, it } from "vitest";
import { normalizePullRequestReview } from "./pullRequestReview";

const allMethods = {
  nameWithOwner: "acme/app",
  squashMergeAllowed: true,
  mergeCommitAllowed: true,
  rebaseMergeAllowed: true,
};

const thread = (input: { isResolved?: boolean; isOutdated?: boolean; body: string }) => ({
  isResolved: input.isResolved ?? false,
  isOutdated: input.isOutdated ?? false,
  path: "src/app.ts",
  line: 12,
  comments: { nodes: [{ author: { login: "rev" }, body: input.body, url: "https://c" }] },
});

describe("normalizePullRequestReview", () => {
  it.each([
    [{ status: "COMPLETED", conclusion: "SUCCESS" }, "success"],
    [{ status: "COMPLETED", conclusion: "FAILURE" }, "failure"],
    [{ status: "COMPLETED", conclusion: "CANCELLED" }, "failure"],
    [{ status: "COMPLETED", conclusion: "TIMED_OUT" }, "failure"],
    [{ status: "COMPLETED", conclusion: "SKIPPED" }, "skipped"],
    [{ status: "COMPLETED", conclusion: "NEUTRAL" }, "neutral"],
    [{ status: "IN_PROGRESS", conclusion: "" }, "pending"],
    [{ status: "QUEUED", conclusion: null }, "pending"],
    [{ state: "SUCCESS" }, "success"],
    [{ state: "ERROR" }, "failure"],
    [{ state: "PENDING" }, "pending"],
  ] as const)("maps %o to %s", (check, expected) => {
    const review = normalizePullRequestReview(
      {
        number: 1,
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [{ name: "ci", ...check }],
      },
      allMethods,
      null,
    );
    expect(review.checks.map((entry) => entry.state)).toEqual([expected]);
  });

  it("orders failures first, keeps allowed merge methods, and lists only open feedback", () => {
    const review = normalizePullRequestReview(
      {
        number: 7,
        state: "OPEN",
        isDraft: true,
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "DIRTY",
        statusCheckRollup: [
          { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://l" },
          { context: "deploy", state: "PENDING", targetUrl: "https://d" },
          { name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://t" },
        ],
        latestReviews: [
          { author: { login: "lead" }, state: "CHANGES_REQUESTED", body: "Split this PR." },
          { author: { login: "peer" }, state: "APPROVED", body: "LGTM" },
          { author: { login: "bot" }, state: "CHANGES_REQUESTED", body: "  " },
        ],
      },
      { ...allMethods, squashMergeAllowed: false },
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  thread({ body: "Handle the null case." }),
                  thread({ body: "Already fixed.", isResolved: true }),
                  thread({ body: "Old code.", isOutdated: true }),
                ],
              },
            },
          },
        },
      },
    );
    expect(review).toEqual({
      number: 7,
      state: "open",
      isDraft: true,
      reviewDecision: "changes_requested",
      mergeState: "conflicting",
      mergeMethods: ["merge", "rebase"],
      comments: [
        { author: "lead", body: "Split this PR.", path: null, line: null, url: null },
        {
          author: "rev",
          body: "Handle the null case.",
          path: "src/app.ts",
          line: 12,
          url: "https://c",
        },
      ],
      checks: [
        { name: "test", state: "failure", url: "https://t" },
        { name: "deploy", state: "pending", url: "https://d" },
        { name: "lint", state: "success", url: "https://l" },
      ],
    });
  });
});
