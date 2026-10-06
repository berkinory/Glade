import * as NodeServices from "@effect/platform-node/NodeServices";
import type { GitActionProgressEvent, GitRunStackedActionInput } from "@glade/contracts/git/git";
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { attachmentPrincipalForSession } from "../../attachments/managedAttachmentPrincipal";
import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore";
import { SessionCredentialServiceLive } from "../../auth/Layers/SessionCredentialService";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { ServerConfig } from "../../server/config";
import { GitActionRuns } from "../Services/GitActionRuns";
import { GitManager } from "../Services/GitManager";
import { GitStatusBroadcaster } from "../Services/GitStatusBroadcaster";
import { GitActionRunsLive } from "./GitActionRuns";

const input: GitRunStackedActionInput = { actionId: "action-1", cwd: "/repo", action: "push" };
const result = {
  action: "push",
  branch: { status: "skipped_not_requested" },
  commit: { status: "skipped_not_requested" },
  push: { status: "pushed", branch: "main" },
  pr: { status: "skipped_not_requested" },
} as const;

const runTest = <A, E>(
  test: (
    release: Deferred.Deferred<void>,
    runs: { count: number; started: Deferred.Deferred<void> },
  ) => Effect.Effect<A, E, GitActionRuns | SessionCredentialService>,
) =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const started = yield* Deferred.make<void>();
    const runs = { count: 0, started };
    const gitManager = Layer.mock(GitManager)({
      runStackedAction: (command, options) =>
        Effect.gen(function* () {
          runs.count += 1;
          yield* Deferred.succeed(started, undefined);
          const base = { actionId: command.actionId, cwd: command.cwd, action: command.action };
          const publish = (event: GitActionProgressEvent) =>
            options?.progressReporter?.publish(event) ?? Effect.void;
          yield* publish({ ...base, kind: "action_started", phases: ["push"] });
          yield* publish({ ...base, kind: "phase_started", phase: "push", label: "Pushing..." });
          yield* Deferred.await(release);
          yield* publish({ ...base, kind: "action_finished", result });
          return result;
        }),
    });
    const statusBroadcaster = Layer.mock(GitStatusBroadcaster)({
      refreshStatus: () => Effect.never,
      streamStatus: () => Stream.empty,
    });
    const sessions = SessionCredentialServiceLive.pipe(
      Layer.provide(SqlitePersistenceMemory),
      Layer.provide(ServerSecretStoreLive),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-git-action-runs-" })),
      Layer.provide(NodeServices.layer),
    );
    const layer = GitActionRunsLive.pipe(
      Layer.provideMerge(Layer.mergeAll(gitManager, statusBroadcaster, sessions)),
    );
    return yield* test(release, runs).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.runPromise);

describe("GitActionRunsLive", () => {
  it("keeps running after the observer drops and reattaches without running Git again", async () => {
    await runTest((release, runs) =>
      Effect.gen(function* () {
        const gitActionRuns = yield* GitActionRuns;
        const sessions = yield* SessionCredentialService;
        const owner = attachmentPrincipalForSession((yield* sessions.issue()).sessionId);
        const otherCaller = attachmentPrincipalForSession((yield* sessions.issue()).sessionId);
        yield* gitActionRuns.attach(input, owner).pipe(Stream.take(1), Stream.runDrain);
        yield* Deferred.succeed(release, undefined);

        const events = yield* Stream.runCollect(
          gitActionRuns.attach({ ...input, resume: true }, owner),
        );
        expect(events.map((event) => event.kind)).toEqual([
          "action_started",
          "phase_started",
          "action_finished",
        ]);
        expect(runs.count).toBe(1);

        const rejected = yield* Effect.exit(
          Stream.runDrain(gitActionRuns.attach({ ...input, resume: true }, otherCaller)),
        );
        expect(Exit.isFailure(rejected)).toBe(true);
        const changed = yield* Effect.exit(
          Stream.runDrain(gitActionRuns.attach({ ...input, action: "commit_push" }, owner)),
        );
        expect(Exit.isFailure(changed)).toBe(true);
        const missing = yield* Effect.exit(
          Stream.runDrain(
            gitActionRuns.attach({ ...input, actionId: "missing", resume: true }, owner),
          ),
        );
        expect(Exit.isFailure(missing)).toBe(true);
        expect(runs.count).toBe(1);
      }),
    );
  });

  it("stops a session-owned run when the session is revoked", async () => {
    await runTest((_release, runs) =>
      Effect.gen(function* () {
        const gitActionRuns = yield* GitActionRuns;
        const sessions = yield* SessionCredentialService;
        const issued = yield* sessions.issue();
        const owner = attachmentPrincipalForSession(issued.sessionId);
        const observer = yield* Stream.runDrain(gitActionRuns.attach(input, owner)).pipe(
          Effect.exit,
          Effect.forkChild,
        );
        yield* Deferred.await(runs.started);
        yield* sessions.revoke(issued.sessionId);

        const exit = yield* Fiber.join(observer);
        expect(Exit.isFailure(exit) && String(exit.cause)).toContain("session ended");
      }),
    );
  });
});
