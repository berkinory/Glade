import { createHash } from "node:crypto";
import { CommandId, MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { GitPullRequestReviewResult } from "@glade/contracts/git/pullRequestReview";
import { Duration, Effect, Layer, Option, Schema } from "effect";

import { GitHub } from "../../git/Services/GitHub.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestWatchRepository } from "../../persistence/Services/PullRequestWatches.ts";
import type { PullRequestWatchRecord } from "../../persistence/Services/PullRequestWatches.ts";
import {
  evaluatePullRequestWatch,
  hasWatchNews,
  initialWatchState,
  PullRequestWatchState,
  type PullRequestWatchOutcome,
} from "../pullRequestWatchEvaluation.ts";
import { PullRequestWatch, type PullRequestWatchShape } from "../Services/PullRequestWatch.ts";

// Checks take minutes; a tighter sweep only spends requests. Idle PRs cost nothing per sweep because
// review reads revalidate with conditional requests first.
const SWEEP_INTERVAL = Duration.minutes(2);
const FIRST_SWEEP_DELAY = Duration.seconds(30);
const FAILURE_LIMIT = 8;
const LOG_EXCERPTS_PER_WAKE = 2;

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(PullRequestWatchState));
const encodeState = (state: PullRequestWatchState) => JSON.stringify(state);

function summarize(outcome: PullRequestWatchOutcome): string {
  return [
    outcome.newFailures.length > 0 ? `checks failed: ${outcome.newFailures.join(", ")}` : null,
    outcome.passed ? "checks passed" : null,
    outcome.newComments.length > 0
      ? `${outcome.newComments.length} new review ${outcome.newComments.length === 1 ? "comment" : "comments"}`
      : null,
    outcome.conflict ? "merge conflict" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

function buildMessage(
  number: number,
  review: GitPullRequestReviewResult,
  outcome: PullRequestWatchOutcome,
  logs: ReadonlyMap<string, string>,
): string {
  const lines = [`[PR watch] Pull request #${number} needs attention.`, ""];
  if (outcome.newFailures.length > 0) {
    lines.push("Checks failed:");
    for (const name of outcome.newFailures) {
      const check = review.checks.find((entry) => entry.name === name);
      lines.push(`- ${name}${check?.url ? ` (${check.url})` : ""}`);
      const log = logs.get(name);
      if (log) lines.push("", "```", log, "```", "");
    }
  }
  if (outcome.passed) lines.push("All required checks passed.");
  if (outcome.newComments.length > 0) {
    lines.push("New review feedback:");
    for (const comment of outcome.newComments) {
      const location = comment.path
        ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}`
        : "";
      lines.push(`- ${comment.author}${location}: ${comment.body}`);
    }
  }
  if (outcome.conflict) lines.push("The branch now conflicts with its base branch.");
  lines.push("", "Address what needs action and push. If nothing needs to change, say so briefly.");
  return lines.join("\n");
}

const make = Effect.gen(function* () {
  const github = yield* GitHub;
  const repository = yield* PullRequestWatchRepository;
  const snapshots = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const failures = new Map<string, number>();

  const wake = (record: PullRequestWatchRecord, text: string, key: string) =>
    Effect.gen(function* () {
      const shell = yield* snapshots.getThreadShellById(ThreadId.makeUnsafe(record.threadId));
      if (Option.isNone(shell)) return;
      const id = `pr-watch:${record.threadId}:${createHash("sha256").update(`${record.startedAt}\u0000${key}`).digest("hex").slice(0, 24)}`;
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(id),
        threadId: ThreadId.makeUnsafe(record.threadId),
        message: { messageId: MessageId.makeUnsafe(id), role: "user", text, attachments: [] },
        dispatchMode: "queue",
        dispatchOrigin: "agent",
        runtimeMode: shell.value.runtimeMode,
        createdAt: new Date().toISOString(),
      });
    });

  const failingLogs = (
    record: PullRequestWatchRecord,
    review: GitPullRequestReviewResult,
    names: ReadonlyArray<string>,
  ) =>
    Effect.forEach(
      review.checks
        .filter((check) => names.includes(check.name) && check.jobId !== null)
        .slice(0, LOG_EXCERPTS_PER_WAKE),
      (check) =>
        github.getCheckLog({ cwd: record.cwd, jobId: check.jobId ?? 0 }).pipe(
          Effect.map((log) => [check.name, log.excerpt] as const),
          Effect.orElseSucceed(() => null),
        ),
      { concurrency: 2 },
    ).pipe(Effect.map((entries) => new Map(entries.filter((entry) => entry !== null))));

  const stopWatch = (record: PullRequestWatchRecord, reason: string) =>
    repository.remove(record.threadId).pipe(
      Effect.tap(() =>
        Effect.logInfo("pull request watch ended", {
          threadId: record.threadId,
          number: record.number,
          reason,
          minutes: Math.round((Date.now() - Date.parse(record.startedAt)) / 60_000),
        }),
      ),
    );

  const processWatch = (record: PullRequestWatchRecord, viewer: string | null) =>
    Effect.gen(function* () {
      const shell = yield* snapshots.getThreadShellById(ThreadId.makeUnsafe(record.threadId));
      if (Option.isNone(shell) || shell.value.archivedAt) {
        return yield* stopWatch(record, "chat archived or deleted");
      }
      const review = yield* github
        .getPullRequestReview({ cwd: record.cwd, number: record.number, priority: "background" })
        .pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        );
      if (!review.ok) {
        // Waiting out a rate limit is not a failure of the watch.
        if (review.error.reason === "rate-limited") return;
        const count = (failures.get(record.threadId) ?? 0) + 1;
        failures.set(record.threadId, count);
        if (count < FAILURE_LIMIT) return;
        failures.delete(record.threadId);
        yield* stopWatch(record, `read failures: ${review.error.detail}`);
        return yield* wake(
          record,
          `[PR watch] Stopped watching pull request #${record.number}: GitHub kept failing (${review.error.detail}).`,
          "stopped",
        );
      }
      failures.delete(record.threadId);
      const previous = Option.getOrElse(decodeState(record.stateJson), () =>
        initialWatchState(review.value),
      );
      const outcome = evaluatePullRequestWatch(previous, review.value, viewer);
      if (outcome.stop) return yield* stopWatch(record, outcome.stop);
      const news = hasWatchNews(outcome);
      const summary = news ? summarize(outcome) : record.lastEvent;
      if (news) {
        const logs = yield* failingLogs(record, review.value, outcome.newFailures);
        yield* wake(
          record,
          buildMessage(record.number, review.value, outcome, logs),
          `${review.value.headSha}\u0000${summary}\u0000${encodeState(outcome.next)}`,
        );
      }
      yield* repository.update({
        threadId: record.threadId,
        startedAt: record.startedAt,
        lastEvent: summary,
        stateJson: encodeState(outcome.next),
        updatedAt: new Date().toISOString(),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("pull request watch pass failed", {
          threadId: record.threadId,
          cause: String(cause),
        }),
      ),
    );

  const sweep = Effect.gen(function* () {
    const records = yield* repository.list;
    if (records.length === 0) return;
    const viewer = yield* github.getViewer().pipe(
      Effect.map((account) => account.login),
      Effect.orElseSucceed(() => null),
    );
    yield* Effect.forEach(records, (record) => processWatch(record, viewer), {
      concurrency: 2,
      discard: true,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("pull request watch sweep failed", { cause: String(cause) }),
    ),
  );

  return {
    start: () =>
      Effect.sleep(FIRST_SWEEP_DELAY).pipe(
        Effect.andThen(Effect.forever(sweep.pipe(Effect.andThen(Effect.sleep(SWEEP_INTERVAL))))),
        Effect.forkScoped,
        Effect.asVoid,
      ),
    setWatch: (input) =>
      input.enabled
        ? github.getPullRequestReview({ cwd: input.cwd, number: input.number }).pipe(
            Effect.flatMap((review) =>
              repository.upsert({
                threadId: input.threadId,
                cwd: input.cwd,
                number: input.number,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastEvent: null,
                stateJson: encodeState(initialWatchState(review)),
              }),
            ),
          )
        : repository.remove(input.threadId),
    status: (threadId) =>
      repository
        .get(threadId)
        .pipe(
          Effect.map((record) =>
            record
              ? { number: record.number, startedAt: record.startedAt, lastEvent: record.lastEvent }
              : null,
          ),
        ),
  } satisfies PullRequestWatchShape;
});

export const PullRequestWatchLive = Layer.effect(PullRequestWatch, make);
