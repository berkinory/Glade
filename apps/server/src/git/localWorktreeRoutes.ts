import path from "node:path";
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  GitLocalWorktreeActionInput,
  GitLocalWorktreeState,
} from "@glade/contracts/git/localWorktree";
import {
  threadHasInFlightTurn,
  threadHasCheckpointRevertInProgress,
} from "../orchestration/commandInvariants";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { GitCoreShape } from "./Services/GitCore";
import { GitCommandError } from "./Errors";
import { localWorktreeActions } from "./localWorktreeActions";
import { sourceControlActions } from "./sourceControlActions";

export function localWorktreeRoutes(
  git: GitCoreShape,
  engine: Pick<OrchestrationEngineShape, "getReadModel">,
) {
  const actions = localWorktreeActions(git);
  const fail = (detail: string) =>
    new GitCommandError({ cwd: "", command: "git", operation: "local worktree", detail });
  const workspace = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const snapshot = yield* engine.getReadModel();
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      if (!thread?.worktreePath || thread.archivedAt || thread.deletedAt)
        return yield* fail("Select an active worktree chat first.");
      return thread.worktreePath;
    });
  const read = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const state = yield* actions.read(yield* workspace(threadId));
      const snapshot = yield* engine.getReadModel();
      const busyPaths = yield* Effect.forEach(
        snapshot.threads.filter(
          (thread) =>
            threadHasInFlightTurn(thread) ||
            threadHasCheckpointRevertInProgress(thread) ||
            thread.handoff?.bootstrapStatus === "pending",
        ),
        (thread) =>
          Effect.gen(function* () {
            const project = snapshot.projects.find(
              (candidate) => candidate.id === thread.projectId,
            );
            const cwd = thread.worktreePath ?? thread.workingDirectory ?? project?.workspaceRoot;
            if (!cwd) return yield* fail("Cannot establish a running agent's working directory.");
            return yield* Effect.tryPromise({
              try: () => fs.realpath(cwd),
              catch: () => fail("Cannot establish a running agent's working directory."),
            });
          }),
      );
      const busy = busyPaths.some((cwd) => {
        return [state.cwd, state.targetCwd].some((root) => {
          const relative = path.relative(root, cwd);
          return (
            relative === "" ||
            (!relative.startsWith(`..${path.sep}`) &&
              relative !== ".." &&
              !path.isAbsolute(relative))
          );
        });
      });
      return {
        ...state,
        blockedReason: busy
          ? "Wait for agents in this worktree and the project checkout to finish."
          : state.blockedReason,
      } satisfies GitLocalWorktreeState;
    });
  const run = (input: GitLocalWorktreeActionInput) =>
    Effect.gen(function* () {
      const cwd = yield* workspace(input.threadId);
      return yield* git.withMutation(
        cwd,
        Effect.gen(function* () {
          let state = yield* read(input.threadId);
          if (input.targetBranch !== undefined && input.targetBranch !== state.targetBranch)
            return yield* fail(
              "The destination branch changed. Review the local target and retry.",
            );
          if (input.action === "sync") {
            if (state.blockedReason || !state.clean || state.ahead > 0 || state.behind === 0)
              return state;
            return yield* actions.apply(state, "update");
          }
          if (state.blockedReason) return yield* fail(state.blockedReason);
          if (input.commit) {
            if (input.action !== "merge")
              return yield* fail("Commit is only supported with local merge.");
            yield* sourceControlActions(git).commitStaged(cwd, input.commit.message, input.commit);
            state = yield* read(input.threadId);
          }
          return yield* actions.apply(state, input.action);
        }),
      );
    });
  return { read, run };
}
