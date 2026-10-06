import { createHash } from "node:crypto";

import { AuthSessionId } from "@glade/contracts/core/baseSchemas";
import type { GitActionProgressEvent, GitRunStackedActionInput } from "@glade/contracts/git/git";
import { stableJsonStringify } from "@glade/shared/browser/browserAutomationCatalogue";
import { Cause, Effect, Exit, Layer, Queue, Scope, Stream } from "effect";

import type { ManagedAttachmentPrincipal } from "../../attachments/managedAttachmentPrincipal";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService";
import { GitActionRunError, type GitManagerServiceError } from "../Errors.ts";
import { GitActionRuns, type GitActionRunsShape } from "../Services/GitActionRuns.ts";
import { GitManager } from "../Services/GitManager.ts";
import { GitStatusBroadcaster } from "../Services/GitStatusBroadcaster.ts";

// Settled results are bounded by count, independent of action size or duration. A missing result
// on resume, including after a server restart, is reported as unknown and never reruns Git.
const MAX_SETTLED_ACTIONS = 64;
// Observers that fall behind lose old output lines, never the latest progress or the outcome.
const OBSERVER_BUFFER = 128;

type RunError = GitActionRunError | GitManagerServiceError;
type Observer = Queue.Queue<GitActionProgressEvent, RunError | Cause.Done>;

interface ActionRun {
  readonly ownerKey: string;
  readonly fingerprint: string;
  readonly observers: Set<Observer>;
  // Enough to rebuild the current phase and hook for a late observer, not the full output log.
  snapshot: GitActionProgressEvent[];
  lastOutput: GitActionProgressEvent | null;
  outcome: Exit.Exit<void, RunError> | null;
}

const unavailable = () =>
  new GitActionRunError({
    detail:
      "The result of this Git action is unavailable. The server may have restarted or the request never arrived. Check the repository status before trying again.",
  });

function fingerprintOf(command: Omit<GitRunStackedActionInput, "resume">): string {
  return createHash("sha256").update(stableJsonStringify(command)).digest("hex");
}

function record(run: ActionRun, event: GitActionProgressEvent): void {
  if (event.kind === "hook_output") {
    run.lastOutput = event;
    return;
  }
  run.lastOutput = null;
  if (event.kind === "action_started") run.snapshot = [event];
  else if (event.kind === "phase_started")
    run.snapshot = [...run.snapshot.filter((item) => item.kind === "action_started"), event];
  else if (event.kind === "hook_started" || event.kind === "hook_finished")
    run.snapshot = [
      ...run.snapshot.filter(
        (item) => item.kind === "action_started" || item.kind === "phase_started",
      ),
      event,
    ];
  else run.snapshot = [...run.snapshot, event];
}

function finish(observer: Observer, outcome: Exit.Exit<void, RunError>): void {
  if (Exit.isFailure(outcome)) Queue.failCauseUnsafe(observer, outcome.cause);
  else Queue.endUnsafe(observer);
}

const makeGitActionRuns = Effect.gen(function* () {
  const gitManager = yield* GitManager;
  const statusBroadcaster = yield* GitStatusBroadcaster;
  const sessions = yield* SessionCredentialService;
  // Runs outlive their requests but not the server: closing this scope interrupts them.
  const runScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const runs = new Map<string, ActionRun>();
  const settled: string[] = [];

  const settle = (actionId: string, run: ActionRun, exit: Exit.Exit<void, RunError>) => {
    const outcome =
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        ? Exit.fail(
            new GitActionRunError({
              detail:
                "The Git action stopped before it finished. Check the repository status before trying again.",
            }),
          )
        : exit;
    run.outcome = outcome;
    for (const observer of run.observers) finish(observer, outcome);
    run.observers.clear();
    settled.push(actionId);
    while (settled.length > MAX_SETTLED_ACTIONS) runs.delete(settled.shift()!);
  };

  const start = (
    command: Omit<GitRunStackedActionInput, "resume">,
    run: ActionRun,
    owner: ManagedAttachmentPrincipal,
  ) => {
    const work = gitManager
      .runStackedAction(command, {
        actionId: command.actionId,
        progressReporter: {
          publish: (event) =>
            Effect.sync(() => {
              record(run, event);
              for (const observer of run.observers) Queue.offerUnsafe(observer, event);
            }),
        },
      })
      .pipe(
        Effect.asVoid,
        Effect.tap(() =>
          statusBroadcaster
            .refreshStatus(command.cwd)
            .pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(runScope)),
        ),
      );
    // Remote sessions keep their runs across socket loss, but revocation or expiry stops them.
    const owned =
      owner.ownerKind === "session"
        ? sessions.runAuthenticatedWork(AuthSessionId.makeUnsafe(owner.ownerId), work).pipe(
            Effect.catchTag("SessionCredentialError", (error) =>
              Effect.fail(
                new GitActionRunError({
                  detail: `The Git action stopped because its session ended: ${error.message} Check the repository status before trying again.`,
                }),
              ),
            ),
          )
        : work;
    return owned.pipe(
      Effect.onExit((exit) => Effect.sync(() => settle(command.actionId, run, exit))),
      Effect.forkIn(runScope),
    );
  };

  const attach: GitActionRunsShape["attach"] = (input, owner) =>
    Stream.callback<GitActionProgressEvent, RunError>(
      (queue) =>
        Effect.gen(function* () {
          const { resume, ...command } = input;
          const ownerKey = `${owner.ownerKind}:${owner.ownerId}`;
          const fingerprint = fingerprintOf(command);
          const existing = runs.get(command.actionId);
          if (existing && existing.ownerKey !== ownerKey)
            return yield* new GitActionRunError({
              detail: "This Git action belongs to another session.",
            });
          if (existing && existing.fingerprint !== fingerprint)
            return yield* new GitActionRunError({
              detail: "This Git action ID was already used for a different action.",
            });
          if (!existing && resume) return yield* unavailable();

          const run: ActionRun = existing ?? {
            ownerKey,
            fingerprint,
            observers: new Set(),
            snapshot: [],
            lastOutput: null,
            outcome: null,
          };
          for (const event of run.snapshot) Queue.offerUnsafe(queue, event);
          if (run.lastOutput) Queue.offerUnsafe(queue, run.lastOutput);
          if (run.outcome) return finish(queue, run.outcome);

          run.observers.add(queue);
          yield* Effect.addFinalizer(() => Effect.sync(() => run.observers.delete(queue)));
          if (!existing) {
            runs.set(command.actionId, run);
            yield* start(command, run, owner);
          }
        }).pipe(
          Effect.uninterruptible,
          // Stream.callback forks this effect and ignores its failure, so fail the queue instead.
          Effect.catchCause((cause) => Queue.failCause(queue, cause)),
        ),
      { bufferSize: OBSERVER_BUFFER, strategy: "sliding" },
    );

  return { attach } satisfies GitActionRunsShape;
});

export const GitActionRunsLive = Layer.effect(GitActionRuns, makeGitActionRuns);
