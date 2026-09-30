import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { pluralize } from "@glade/shared/text/text";
import { toastManager } from "./ui/toast";

export function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

const DIRTY_WORKTREE_ERROR_PATTERN =
  /Uncommitted changes block checkout to ([^:\n]+):\s*\n((?:\s*-\s*.+(?:\n|$))+)/;
const STASH_CONFLICT_PATTERN = /Stash could not be applied|Stash applied with merge conflicts/;
const UNRESOLVED_INDEX_PATTERN = /you need to resolve your current index/i;
const GIT_INDEX_LOCK_PATTERN =
  /(?:Unable to create '([^']*\.git\/index\.lock)'|Another git process seems to be running|\.git\/index\.lock.*File exists)/i;
const GIT_INDEX_WRITE_PATTERN = /could not write index/i;
let activeBranchRecoveryToastId: ReturnType<typeof toastManager.add> | null = null;

function closeActiveBranchRecoveryToast(): void {
  if (!activeBranchRecoveryToastId) return;
  toastManager.close(activeBranchRecoveryToastId);
  activeBranchRecoveryToastId = null;
}

function addBranchRecoveryToast(input: Parameters<typeof toastManager.add>[0]) {
  closeActiveBranchRecoveryToast();
  activeBranchRecoveryToastId = toastManager.add(input);
  return activeBranchRecoveryToastId;
}

function parseDirtyWorktreeError(error: unknown): { branch: string; files: string[] } | null {
  const detail = error instanceof Error ? error.message : String(error);
  const match = DIRTY_WORKTREE_ERROR_PATTERN.exec(detail);
  if (!match?.[1] || !match[2]) return null;
  const files = match[2]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (files.length === 0) return null;
  return {
    branch: match[1].trim(),
    files,
  };
}

function isStashConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STASH_CONFLICT_PATTERN.test(message);
}

function isUnresolvedIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return UNRESOLVED_INDEX_PATTERN.test(message);
}

function parseGitIndexLockError(error: unknown): { lockPath: string | null } | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = GIT_INDEX_LOCK_PATTERN.exec(message);
  if (!match) return null;
  return {
    lockPath: match[1]?.trim() || null,
  };
}

function isGitIndexWriteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return GIT_INDEX_WRITE_PATTERN.test(message);
}

function formatDirtyWorktreeDescription(files: string[]): string {
  const basenames = files.map((file) => file.split("/").pop() ?? file);
  if (basenames.length <= 3) {
    return `${basenames.join(", ")} ${pluralize(basenames.length, "has", "have")} uncommitted changes. Commit or stash before switching.`;
  }
  const remaining = basenames.length - 2;
  return `${basenames.slice(0, 2).join(", ")} and ${remaining} other ${pluralize(remaining, "file")} have uncommitted changes. Commit or stash before switching.`;
}

export function handleCheckoutError(
  error: unknown,
  input: {
    api: NativeApi;
    branch: string;
    cwd: string;
    fallbackTitle: string;
    onSuccess: () => void;
    runBranchAction: (
      action: () => Promise<void>,
      options?: { readonly refreshCwds?: readonly string[] },
    ) => void;
    onRequestDiscardStash: (input: { cwd: string }) => void;
  },
): void {
  const retryRefreshOptions = { refreshCwds: [input.cwd] } as const;
  const retryStashAndCheckout = async (): Promise<void> => {
    await input.api.git.stashAndCheckout({ cwd: input.cwd, branch: input.branch });
    input.onSuccess();
  };

  const addGitIndexLockToast = (error: unknown): void => {
    const lockError = parseGitIndexLockError(error);
    if (!lockError) return;
    const lockFileLabel = lockError.lockPath
      ? lockError.lockPath.split("/").slice(-2).join("/")
      : ".git/index.lock";
    addBranchRecoveryToast({
      type: "error",
      title: "Git index is locked.",
      description: `${lockFileLabel} already exists. Close any running Git operation, remove the stale lock file if none is running, then retry.`,
      data: { copyText: toBranchActionErrorMessage(error) },
      actionProps: {
        children: "Remove lock & retry",
        onClick: () => {
          input.runBranchAction(async () => {
            try {
              await input.api.git.removeIndexLock({ cwd: input.cwd });
              await retryStashAndCheckout();
            } catch (retryError) {
              handleCheckoutError(retryError, input);
            }
          }, retryRefreshOptions);
        },
      },
    });
  };

  const addGitIndexWriteToast = (error: unknown): void => {
    addBranchRecoveryToast({
      type: "error",
      title: "Git index could not be written.",
      description:
        "Git could not update the repository index. Retry after any current Git operation finishes.",
      data: { copyText: toBranchActionErrorMessage(error) },
      actionProps: {
        children: "Retry stash & switch",
        onClick: () => {
          input.runBranchAction(async () => {
            try {
              await retryStashAndCheckout();
            } catch (retryError) {
              handleCheckoutError(retryError, input);
            }
          }, retryRefreshOptions);
        },
      },
    });
  };

  const dirtyWorktree = parseDirtyWorktreeError(error);
  if (dirtyWorktree) {
    const copyText = toBranchActionErrorMessage(error);
    addBranchRecoveryToast({
      type: "warning",
      title: "Uncommitted changes block checkout.",
      description: formatDirtyWorktreeDescription(dirtyWorktree.files),
      data: { copyText },
      actionProps: {
        children: "Stash & Switch",
        onClick: () => {
          closeActiveBranchRecoveryToast();
          input.runBranchAction(async () => {
            try {
              await retryStashAndCheckout();
            } catch (stashError) {
              if (parseGitIndexLockError(stashError)) {
                addGitIndexLockToast(stashError);
                return;
              }
              if (isGitIndexWriteError(stashError)) {
                addGitIndexWriteToast(stashError);
                return;
              }
              if (isStashConflictError(stashError)) {
                input.onSuccess();
                addBranchRecoveryToast({
                  type: "warning",
                  title: "Changes saved, but not reapplied.",
                  description:
                    "Glade switched branches and kept your changes in a stash because they could not be restored onto this branch cleanly.",
                  data: { copyText: toBranchActionErrorMessage(stashError) },
                  actionProps: {
                    children: "Discard stash",
                    className:
                      "text-destructive [:hover,[data-pressed]]:bg-destructive/10 [:hover,[data-pressed]]:text-destructive",
                    onClick: () => {
                      closeActiveBranchRecoveryToast();
                      input.onRequestDiscardStash({ cwd: input.cwd });
                    },
                  },
                });
                return;
              }
              if (parseDirtyWorktreeError(stashError)) {
                addBranchRecoveryToast({
                  type: "error",
                  title: "Cannot switch branches.",
                  description:
                    "Some conflicting files are not covered by git stash, such as ignored files. Move or remove them before switching.",
                  data: { copyText: toBranchActionErrorMessage(stashError) },
                });
                return;
              }
              addBranchRecoveryToast({
                type: "error",
                title: "Failed to stash and switch.",
                description: toBranchActionErrorMessage(stashError),
                data: { copyText: toBranchActionErrorMessage(stashError) },
              });
            }
          }, retryRefreshOptions);
        },
      },
    });
    return;
  }

  if (parseGitIndexLockError(error)) {
    addGitIndexLockToast(error);
    return;
  }
  if (isGitIndexWriteError(error)) {
    addGitIndexWriteToast(error);
    return;
  }

  addBranchRecoveryToast({
    type: "error",
    title: isUnresolvedIndexError(error)
      ? "Unresolved conflicts in the repository."
      : input.fallbackTitle,
    description: toBranchActionErrorMessage(error),
    data: { copyText: toBranchActionErrorMessage(error) },
  });
}
