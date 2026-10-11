import type {
  GitPullRequestCheck,
  GitPullRequestReviewResult,
} from "@glade/contracts/git/pullRequestReview";
import { describe, expect, it } from "vitest";

import {
  evaluatePullRequestWatch,
  initialWatchState,
  MAX_COMMENT_ONLY_WAKES,
} from "./pullRequestWatchEvaluation";

const check = (name: string, state: GitPullRequestCheck["state"], required = false) =>
  ({ name, state, required, url: null, jobId: null, runId: null }) satisfies GitPullRequestCheck;

const review = (patch: Partial<GitPullRequestReviewResult> = {}): GitPullRequestReviewResult => ({
  number: 1,
  state: "open",
  isDraft: false,
  headSha: "a1",
  checks: [check("test", "pending")],
  reviewDecision: null,
  mergeState: "clean",
  comments: [],
  mergeMethods: ["squash"],
  ...patch,
});

const comment = (author: string, body: string) => ({
  author,
  authorAvatarUrl: null,
  body,
  path: null,
  line: null,
  url: `https://c/${author}/${body}`,
});

describe("evaluatePullRequestWatch", () => {
  it("stays quiet at the baseline and reports a new failure once", () => {
    const start = initialWatchState(review());
    expect(evaluatePullRequestWatch(start, review(), null).newFailures).toEqual([]);

    const failed = evaluatePullRequestWatch(
      start,
      review({ checks: [check("test", "failure")] }),
      null,
    );
    expect(failed.newFailures).toEqual(["test"]);
    const again = evaluatePullRequestWatch(
      failed.next,
      review({ checks: [check("test", "failure")] }),
      null,
    );
    expect(again.newFailures).toEqual([]);
  });

  it("reports a failure again after a rerun drops it off and it fails anew", () => {
    let state = initialWatchState(review({ checks: [check("test", "failure")] }));
    state = evaluatePullRequestWatch(
      state,
      review({ checks: [check("test", "pending")] }),
      null,
    ).next;
    expect(
      evaluatePullRequestWatch(state, review({ checks: [check("test", "failure")] }), null)
        .newFailures,
    ).toEqual(["test"]);
  });

  it("judges passing on required checks and reports it once per head", () => {
    const checks = [check("test", "success", true), check("optional", "failure")];
    const start = initialWatchState(review({ checks: [check("test", "pending", true)] }));
    const passed = evaluatePullRequestWatch(start, review({ checks }), null);
    expect(passed.passed).toBe(true);
    expect(evaluatePullRequestWatch(passed.next, review({ checks }), null).passed).toBe(false);
    expect(
      evaluatePullRequestWatch(passed.next, review({ headSha: "b2", checks }), null).passed,
    ).toBe(true);
  });

  it("ignores the agent's own comments and stops after repeated comment-only wakes", () => {
    let state = initialWatchState(review());
    const own = evaluatePullRequestWatch(
      state,
      review({ comments: [comment("agent", "done")] }),
      "agent",
    );
    expect(own.newComments).toEqual([]);

    for (let index = 1; index <= MAX_COMMENT_ONLY_WAKES; index += 1) {
      const outcome = evaluatePullRequestWatch(
        state,
        review({ comments: [comment("rev", `note ${index}`)] }),
        "agent",
      );
      expect(outcome.newComments).toHaveLength(1);
      expect(outcome.stop).toBe(index === MAX_COMMENT_ONLY_WAKES ? "comment-limit" : null);
      state = outcome.next;
    }
  });

  it("keeps the last conflict state while GitHub recomputes mergeability", () => {
    const start = initialWatchState(review());
    const conflicted = evaluatePullRequestWatch(start, review({ mergeState: "conflicting" }), null);
    expect(conflicted.conflict).toBe(true);
    const unknown = evaluatePullRequestWatch(
      conflicted.next,
      review({ mergeState: "unknown" }),
      null,
    );
    expect(unknown.conflict).toBe(false);
    expect(unknown.next.conflict).toBe(true);
  });

  it.each(["merged", "closed"] as const)("ends the watch when the PR is %s", (state) => {
    expect(
      evaluatePullRequestWatch(initialWatchState(review()), review({ state }), null).stop,
    ).toBe(state);
  });
});
