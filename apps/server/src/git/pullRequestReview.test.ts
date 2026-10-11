import { describe, expect, it } from "vitest";
import { collapseCheckRuns, normalizePullRequestReview } from "./pullRequestReview";

const checkRun = (fields: Record<string, unknown>) => ({
  __typename: "CheckRun",
  name: "ci",
  ...fields,
});

describe("collapseCheckRuns", () => {
  it.each([
    [{ status: "COMPLETED", conclusion: "SUCCESS" }, "success"],
    [{ status: "COMPLETED", conclusion: "FAILURE" }, "failure"],
    [{ status: "COMPLETED", conclusion: "CANCELLED" }, "failure"],
    [{ status: "COMPLETED", conclusion: "TIMED_OUT" }, "failure"],
    [{ status: "COMPLETED", conclusion: "SKIPPED" }, "skipped"],
    [{ status: "COMPLETED", conclusion: "NEUTRAL" }, "neutral"],
    [{ status: "IN_PROGRESS", conclusion: null }, "pending"],
    [{ status: "QUEUED" }, "pending"],
  ] as const)("maps %o to %s", (fields, expected) => {
    expect(collapseCheckRuns([checkRun(fields)]).map((check) => check.state)).toEqual([expected]);
  });

  it.each([
    [{ state: "SUCCESS" }, "success"],
    [{ state: "ERROR" }, "failure"],
    [{ state: "PENDING" }, "pending"],
  ] as const)("maps status context %o to %s", (fields, expected) => {
    const context = { __typename: "StatusContext", context: "deploy", ...fields };
    expect(collapseCheckRuns([context]).map((check) => check.state)).toEqual([expected]);
  });

  it("lets a rerun still in progress outrank an older finished run of the same check", () => {
    const checks = collapseCheckRuns([
      checkRun({ status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-10-10T10:05:00Z" }),
      checkRun({ status: "IN_PROGRESS", startedAt: "2026-10-10T10:00:00Z", databaseId: 7 }),
    ]);
    expect(checks).toEqual([
      { name: "ci", state: "pending", url: null, required: false, jobId: 7, runId: null },
    ]);
  });

  it("keeps the newest finished run when no rerun is pending", () => {
    const checks = collapseCheckRuns([
      checkRun({ status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-10-10T10:00:00Z" }),
      checkRun({ status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-10-10T10:05:00Z" }),
    ]);
    expect(checks.map((check) => check.state)).toEqual(["success"]);
  });
});

describe("normalizePullRequestReview", () => {
  it("orders failures first, keeps allowed merge methods, and lists only open feedback", () => {
    const thread = (body: string, flags: { isResolved?: boolean; isOutdated?: boolean } = {}) => ({
      isResolved: flags.isResolved ?? false,
      isOutdated: flags.isOutdated ?? false,
      path: "src/app.ts",
      line: 12,
      comments: { nodes: [{ author: { login: "rev" }, body, url: "https://c" }] },
    });
    const review = normalizePullRequestReview({
      repository: {
        squashMergeAllowed: false,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: true,
        pullRequest: {
          id: "PR_1",
          number: 7,
          state: "OPEN",
          isDraft: true,
          reviewDecision: "CHANGES_REQUESTED",
          mergeStateStatus: "DIRTY",
          headRefOid: "abc",
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        checkRun({
                          name: "lint",
                          status: "COMPLETED",
                          conclusion: "SUCCESS",
                          detailsUrl: "https://l",
                        }),
                        {
                          __typename: "StatusContext",
                          context: "deploy",
                          state: "PENDING",
                          targetUrl: "https://d",
                        },
                        checkRun({
                          name: "test",
                          status: "COMPLETED",
                          conclusion: "FAILURE",
                          detailsUrl: "https://t",
                          databaseId: 11,
                          isRequired: true,
                          checkSuite: { workflowRun: { databaseId: 5 } },
                        }),
                      ],
                    },
                  },
                },
              },
            ],
          },
          latestReviews: {
            nodes: [
              { author: { login: "lead" }, state: "CHANGES_REQUESTED", body: "Split this PR." },
              { author: { login: "peer" }, state: "APPROVED", body: "LGTM" },
              { author: { login: "bot" }, state: "CHANGES_REQUESTED", body: "  " },
            ],
          },
          reviewThreads: {
            nodes: [
              thread("Handle the null case."),
              thread("Already fixed.", { isResolved: true }),
              thread("Old code.", { isOutdated: true }),
            ],
          },
        },
      },
    });
    expect(review).toEqual({
      number: 7,
      state: "open",
      isDraft: true,
      headSha: "abc",
      reviewDecision: "changes_requested",
      mergeState: "conflicting",
      mergeMethods: ["merge", "rebase"],
      comments: [
        {
          author: "lead",
          authorAvatarUrl: null,
          body: "Split this PR.",
          path: null,
          line: null,
          url: null,
        },
        {
          author: "rev",
          authorAvatarUrl: null,
          body: "Handle the null case.",
          path: "src/app.ts",
          line: 12,
          url: "https://c",
        },
      ],
      checks: [
        { name: "test", state: "failure", url: "https://t", required: true, jobId: 11, runId: 5 },
        {
          name: "deploy",
          state: "pending",
          url: "https://d",
          required: false,
          jobId: null,
          runId: null,
        },
        {
          name: "lint",
          state: "success",
          url: "https://l",
          required: false,
          jobId: null,
          runId: null,
        },
      ],
    });
  });
});
