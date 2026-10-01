import { randomUUID } from "node:crypto";
import { Effect, Layer, Path } from "effect";
import { GitManagerError, gitManagerError } from "../Errors.ts";
import { GitCore } from "../Services/GitCore.ts";
import type { GitManagerShape } from "../Services/GitManager.ts";
import { GitHandoff } from "../Services/GitHandoff.ts";
import { ServerConfig } from "../../server/config.ts";

interface FailedLocalHandoffRecovery {
  worktreeRecreated: boolean;
  worktreeChangesRestored: boolean;
  localChangesRestored: boolean;
  recoveryNotes: ReadonlyArray<string>;
}

interface FailedLocalTransferRecovery extends FailedLocalHandoffRecovery {
  localCheckoutRestored: boolean;
}

function buildFailedLocalHandoffRecoveryDetail(
  baseMessage: string,
  recovery: FailedLocalHandoffRecovery,
): string {
  return `${baseMessage} ${[
    recovery.worktreeRecreated
      ? "The original worktree was recreated."
      : "The original worktree could not be recreated automatically.",
    recovery.worktreeChangesRestored
      ? "Recovered worktree changes were reapplied."
      : "Recovered worktree changes remain in the Git stash.",
    recovery.localChangesRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}

function buildFailedLocalTransferDetail(
  baseMessage: string,
  recovery: FailedLocalTransferRecovery,
): string {
  return `${baseMessage} ${[
    recovery.worktreeRecreated
      ? "The original worktree was recreated."
      : "The original worktree could not be recreated automatically.",
    recovery.worktreeChangesRestored
      ? "The thread changes were restored to that worktree."
      : "The thread changes remain in the Git stash.",
    recovery.localCheckoutRestored
      ? "Local checkout was restored."
      : "Local checkout could not be fully restored automatically.",
    recovery.localChangesRestored
      ? "Previous local changes were restored."
      : "Previous local changes remain in the Git stash.",
    ...recovery.recoveryNotes,
  ].join(" ")}`.trim();
}

function combineGitMessages(stdout: string, stderr: string): string | null {
  const parts = [stdout.trim(), stderr.trim()].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n").trim();
}

const makeGitHandoff = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const path = yield* Path.Path;
  const { worktreesDir } = yield* ServerConfig;
  const readStashRef = (cwd: string) =>
    gitCore
      .execute({
        operation: "GitManager.handoffThread.readStashRef",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "refs/stash"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) return null;
          const trimmed = result.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      );

  const readHeadRef = (cwd: string) =>
    gitCore
      .execute({
        operation: "GitManager.handoffThread.readHeadRef",
        cwd,
        args: ["rev-parse", "HEAD"],
        timeoutMs: 5_000,
      })
      .pipe(
        Effect.map((result) => {
          const trimmed = result.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      );

  const checkoutDetached = (cwd: string, ref: string) =>
    gitCore
      .execute({
        operation: "GitManager.handoffThread.checkoutDetached",
        cwd,
        args: ["checkout", "--detach", ref],
        timeoutMs: 30_000,
      })
      .pipe(Effect.asVoid);

  const buildNamedWorktreePath = (cwd: string, name: string) => {
    const repoName = path.basename(cwd);
    const sanitizedName = name.trim().replaceAll("/", "-");
    return path.join(worktreesDir, repoName, sanitizedName);
  };

  const createDetachedWorktree = (input: {
    cwd: string;
    ref: string;
    path: string | null;
    name?: string | null;
  }) =>
    Effect.gen(function* () {
      const resolvedPath =
        input.path ?? (input.name ? buildNamedWorktreePath(input.cwd, input.name) : null);
      const worktree = yield* gitCore.createDetachedWorktree({
        cwd: input.cwd,
        ref: input.ref,
        path: resolvedPath,
      });
      return worktree;
    });

  const stashWorkingTree = (cwd: string, label: string) =>
    Effect.gen(function* () {
      if (!(yield* gitCore.statusDetails(cwd)).hasWorkingTreeChanges) {
        return {
          hadChanges: false,
          stashRef: null,
        };
      }
      const beforeRef = yield* readStashRef(cwd);
      yield* gitCore.execute({
        operation: "GitManager.handoffThread.stashPush",
        cwd,
        args: ["stash", "push", "--include-untracked", "-m", label],
        timeoutMs: 30_000,
      });
      const afterRef = yield* readStashRef(cwd);
      if (afterRef === beforeRef) {
        return yield* gitManagerError(
          "handoffThread",
          "Git did not create a stash entry while preparing the thread handoff.",
        );
      }
      return {
        hadChanges: true,
        stashRef: afterRef,
      };
    });

  const dropStashBySha = (cwd: string, stashSha: string) =>
    Effect.gen(function* () {
      const listResult = yield* gitCore.execute({
        operation: "GitManager.handoffThread.listStashShas",
        cwd,
        args: ["stash", "list", "--format=%H"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      });
      if (listResult.code !== 0) return;
      const index = listResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .indexOf(stashSha);
      if (index < 0) return;
      yield* gitCore.execute({
        operation: "GitManager.handoffThread.stashDrop",
        cwd,
        args: ["stash", "drop", `stash@{${index}}`],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      });
    });

  const popStash = (cwd: string, stashRef: string | null) =>
    Effect.gen(function* () {
      if (!stashRef) {
        return {
          conflictsDetected: false,
          message: null,
        };
      }

      const result = yield* gitCore
        .execute({
          operation: "GitManager.handoffThread.stashApply",
          cwd,
          args: ["stash", "apply", "--index", stashRef],
          allowNonZeroExit: true,
          timeoutMs: 30_000,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.succeed({
              code: 1,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
      if (result.code === 0) {
        yield* dropStashBySha(cwd, stashRef).pipe(Effect.catch(() => Effect.void));
        return {
          conflictsDetected: false,
          message: null,
        };
      }
      return {
        conflictsDetected: true,
        message:
          combineGitMessages(result.stdout, result.stderr) ??
          "Git reported conflicts while applying the handed off changes.",
      };
    });

  const restoreSourceStash = (cwd: string, stashRef: string | null) =>
    popStash(cwd, stashRef).pipe(Effect.asVoid);

  const restoreStashes = (restores: ReadonlyArray<{ cwd: string; stashRef: string | null }>) =>
    Effect.forEach(restores, (entry) => restoreSourceStash(entry.cwd, entry.stashRef), {
      concurrency: 1,
      discard: true,
    });

  const restoreLocalHandoffSource = (input: {
    cwd: string;
    originalBranch: string | null;
    originalHeadRef: string | null;
    currentBranch: string | null;
    stashRef: string | null;
  }) =>
    Effect.gen(function* () {
      let checkoutRestored = input.originalBranch === input.currentBranch;
      const recoveryNotes: string[] = [];

      if (
        input.originalBranch &&
        input.currentBranch &&
        input.originalBranch !== input.currentBranch
      ) {
        checkoutRestored = yield* Effect.scoped(
          gitCore.checkoutBranch({
            cwd: input.cwd,
            branch: input.originalBranch,
          }),
        ).pipe(
          Effect.as(true),
          Effect.catch((error) => {
            recoveryNotes.push(
              `Local could not be returned to '${input.originalBranch}': ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return Effect.succeed(false);
          }),
        );
      } else if (!input.originalBranch && input.originalHeadRef) {
        checkoutRestored = yield* checkoutDetached(input.cwd, input.originalHeadRef).pipe(
          Effect.as(true),
          Effect.catch((error) => {
            recoveryNotes.push(
              `Local could not be returned to its previous detached HEAD: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return Effect.succeed(false);
          }),
        );
      }

      const stashRestore = yield* popStash(input.cwd, input.stashRef);
      const stashRestored = !stashRestore.conflictsDetected;
      if (stashRestore.conflictsDetected) {
        recoveryNotes.push(
          `${stashRestore.message ?? "Git reported conflicts while restoring the original Local changes."}
The local stash entry was kept for recovery.`,
        );
      }

      return {
        checkoutRestored,
        stashRestored,
        recoveryNotes,
      };
    });

  const restoreRemovedWorktreeAfterFailedLocalCheckout = (input: {
    cwd: string;
    worktreePath: string | null;
    branch: string | null;
    ref: string | null;
    worktreeStashRef: string | null;
    localStashRef: string | null;
  }) =>
    Effect.gen(function* () {
      const recoveryNotes: string[] = [];
      let worktreeRecreated = false;
      let worktreeChangesRestored = input.worktreeStashRef === null;
      let localChangesRestored = input.localStashRef === null;

      if (input.worktreePath) {
        const recreated =
          input.branch !== null
            ? yield* gitCore
                .createWorktree({
                  cwd: input.cwd,
                  branch: input.branch,
                  path: input.worktreePath,
                })
                .pipe(Effect.catch(() => Effect.succeed(null)))
            : input.ref
              ? yield* createDetachedWorktree({
                  cwd: input.cwd,
                  ref: input.ref,
                  path: input.worktreePath,
                }).pipe(Effect.catch(() => Effect.succeed(null)))
              : null;

        if (recreated?.worktree.path) {
          worktreeRecreated = true;
          const worktreeRestore = yield* popStash(recreated.worktree.path, input.worktreeStashRef);
          worktreeChangesRestored = !worktreeRestore.conflictsDetected;
          if (worktreeRestore.conflictsDetected) {
            recoveryNotes.push(
              `${worktreeRestore.message ?? "Git reported conflicts while restoring the recovered worktree changes."}
The worktree stash entry was kept for recovery.`,
            );
          }
        } else if (input.worktreeStashRef) {
          recoveryNotes.push(
            "The thread worktree could not be recreated automatically. Its uncommitted changes were kept in the Git stash for manual recovery.",
          );
        }
      }

      const localRestore = yield* popStash(input.cwd, input.localStashRef);
      localChangesRestored = !localRestore.conflictsDetected;
      if (localRestore.conflictsDetected) {
        recoveryNotes.push(
          `${localRestore.message ?? "Git reported conflicts while restoring your previous local changes."}
The local stash entry was kept for recovery.`,
        );
      }

      return {
        worktreeRecreated,
        worktreeChangesRestored,
        localChangesRestored,
        recoveryNotes,
      };
    });

  const rollbackFailedLocalTransfer = (input: {
    cwd: string;
    originalBranch: string | null;
    originalHeadRef: string | null;
    currentBranch: string | null;
    worktreePath: string | null;
    worktreeBranch: string | null;
    worktreeRef: string | null;
    worktreeStashRef: string | null;
    localStashRef: string | null;
  }) =>
    Effect.gen(function* () {
      const worktreeRecovery = yield* restoreRemovedWorktreeAfterFailedLocalCheckout({
        cwd: input.cwd,
        worktreePath: input.worktreePath,
        branch: input.worktreeBranch,
        ref: input.worktreeRef,
        worktreeStashRef: input.worktreeStashRef,
        localStashRef: null,
      });

      const localRecovery = yield* restoreLocalHandoffSource({
        cwd: input.cwd,
        originalBranch: input.originalBranch,
        originalHeadRef: input.originalHeadRef,
        currentBranch: input.currentBranch,
        stashRef: input.localStashRef,
      });

      return {
        worktreeRecreated: worktreeRecovery.worktreeRecreated,
        worktreeChangesRestored: worktreeRecovery.worktreeChangesRestored,
        localCheckoutRestored: localRecovery.checkoutRestored,
        localChangesRestored: localRecovery.stashRestored,
        recoveryNotes: [...worktreeRecovery.recoveryNotes, ...localRecovery.recoveryNotes],
      };
    });

  const handoffThread: GitManagerShape["handoffThread"] = Effect.fnUntraced(function* (input) {
    if (input.targetMode !== "local") {
      return yield* gitManagerError(
        "handoffThread",
        "Creating a worktree through handoff is no longer supported.",
      );
    }
    const currentLocalStatus = yield* gitCore.statusDetails(input.cwd);

    if (!input.worktreePath) {
      return yield* gitManagerError(
        "handoffThread",
        "Cannot hand off to Local because this thread does not have a materialized worktree.",
      );
    }

    const worktreeHeadRef = yield* readHeadRef(input.worktreePath);
    const targetLocalBranch =
      input.currentBranch ?? input.associatedWorktreeBranch ?? input.preferredLocalBranch ?? null;
    if (!(targetLocalBranch ?? worktreeHeadRef)) {
      return yield* gitManagerError(
        "handoffThread",
        "Cannot hand off to Local because the worktree thread does not have a recoverable HEAD reference.",
      );
    }

    const associatedWorktreePath = input.associatedWorktreePath ?? input.worktreePath;
    const associatedWorktreeBranch = input.associatedWorktreeBranch ?? input.currentBranch ?? null;
    const associatedWorktreeRef =
      input.associatedWorktreeRef ?? worktreeHeadRef ?? associatedWorktreeBranch;
    const originalLocalBranch = currentLocalStatus.branch ?? null;
    const originalLocalHeadRef = yield* readHeadRef(input.cwd);
    let currentLocalBranchAfterPreparation = originalLocalBranch;

    const preservedLocalStash = yield* stashWorkingTree(
      input.cwd,
      `glade preserve local handoff ${randomUUID()}`,
    );
    const sourceStash = yield* stashWorkingTree(
      input.worktreePath,
      `glade handoff to local ${randomUUID()}`,
    );

    yield* gitCore
      .removeWorktree({
        cwd: input.cwd,
        path: input.worktreePath,
      })
      .pipe(
        Effect.catch((error) =>
          restoreStashes([
            { cwd: input.worktreePath!, stashRef: sourceStash.stashRef },
            { cwd: input.cwd, stashRef: preservedLocalStash.stashRef },
          ]).pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );

    const recoverFailedCheckout = (error: { readonly message: string }) =>
      restoreRemovedWorktreeAfterFailedLocalCheckout({
        cwd: input.cwd,
        worktreePath: associatedWorktreePath,
        branch: associatedWorktreeBranch,
        ref: associatedWorktreeRef,
        worktreeStashRef: sourceStash.stashRef,
        localStashRef: preservedLocalStash.stashRef,
      }).pipe(
        Effect.flatMap((recovery) =>
          Effect.fail(
            new GitManagerError({
              operation: "GitManager.handoffThread",
              detail: buildFailedLocalHandoffRecoveryDetail(error.message, recovery),
              cause: error,
            }),
          ),
        ),
      );

    if (targetLocalBranch && currentLocalStatus.branch !== targetLocalBranch) {
      yield* Effect.scoped(
        gitCore.checkoutBranch({
          cwd: input.cwd,
          branch: targetLocalBranch,
        }),
      ).pipe(Effect.catch(recoverFailedCheckout));
      currentLocalBranchAfterPreparation = targetLocalBranch;
    } else if (!targetLocalBranch && worktreeHeadRef) {
      yield* checkoutDetached(input.cwd, worktreeHeadRef).pipe(Effect.catch(recoverFailedCheckout));
      currentLocalBranchAfterPreparation = null;
    }

    const threadTransfer = yield* popStash(input.cwd, sourceStash.stashRef);
    if (threadTransfer.conflictsDetected) {
      const recovery = yield* rollbackFailedLocalTransfer({
        cwd: input.cwd,
        originalBranch: originalLocalBranch,
        originalHeadRef: originalLocalHeadRef,
        currentBranch: currentLocalBranchAfterPreparation,
        worktreePath: associatedWorktreePath,
        worktreeBranch: associatedWorktreeBranch,
        worktreeRef: associatedWorktreeRef,
        worktreeStashRef: sourceStash.stashRef,
        localStashRef: preservedLocalStash.stashRef,
      });
      return yield* new GitManagerError({
        operation: "GitManager.handoffThread",
        detail: buildFailedLocalTransferDetail(
          `${
            threadTransfer.message ??
            "Git reported conflicts while applying the handed off changes."
          } The handoff was rolled back so the thread stays in its worktree.`,
          recovery,
        ),
      });
    }

    const localTransfer = yield* popStash(input.cwd, preservedLocalStash.stashRef);
    const changesTransferred = sourceStash.hadChanges || preservedLocalStash.hadChanges;
    const movedThreadChanges = sourceStash.hadChanges;
    const restoredLocalChanges = preservedLocalStash.hadChanges;
    const localTargetLabel = targetLocalBranch
      ? `main local checkout on '${targetLocalBranch}'`
      : "local checkout in detached HEAD";
    const message = localTransfer.conflictsDetected
      ? `${
          localTransfer.message ??
          "Git reported conflicts while restoring your previous local changes."
        }\nYour previous local stash entry was kept for recovery.`
      : movedThreadChanges && restoredLocalChanges
        ? `Moved the thread back to the ${localTargetLabel}, carried its uncommitted work over, and restored your previous local changes.`
        : movedThreadChanges
          ? `Moved the thread back to the ${localTargetLabel} and carried its uncommitted work over.`
          : restoredLocalChanges
            ? `Moved the thread back to the ${localTargetLabel} and restored your previous local changes.`
            : `Moved the thread back to the ${localTargetLabel}.`;

    return {
      targetMode: "local",
      branch: targetLocalBranch,
      worktreePath: null,
      associatedWorktreePath,
      associatedWorktreeBranch,
      associatedWorktreeRef,
      changesTransferred,
      conflictsDetected: localTransfer.conflictsDetected,
      message,
    };
  });
  return { handoffThread };
});

export const GitHandoffLive = Layer.effect(GitHandoff, makeGitHandoff);
