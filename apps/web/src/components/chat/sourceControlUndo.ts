import type { QueryClient } from "@tanstack/react-query";
import { invalidateGitQueriesForCwds } from "~/lib/gitQueryOptions";
import { ensureNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import { useCommitDrafts } from "./commitDraftStore";

// The server re-checks that expectedHead is still the latest unpublished commit, so a stale
// History row or toast can never undo a different commit.
export async function undoCommit(
  queryClient: QueryClient,
  cwd: string,
  expectedHead: string,
): Promise<boolean> {
  try {
    const { message } = await ensureNativeApi().git.undoCommit({ cwd, expectedHead });
    if (!(useCommitDrafts.getState().messages[cwd] ?? "").trim())
      useCommitDrafts.getState().set(cwd, message);
    return true;
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not undo commit",
      description: error instanceof Error ? error.message : "Git operation failed.",
    });
    return false;
  } finally {
    void invalidateGitQueriesForCwds(queryClient, [cwd]);
  }
}
