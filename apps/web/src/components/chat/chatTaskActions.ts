import { confirmWorkspaceRestore } from "./confirmWorkspaceRestore";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { PendingFileUndo } from "~/components/ChatView.logic.session";
import { localSubagentThreadId } from "~/components/ChatView.selectors";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import type { Thread } from "~/types";

export async function interruptThreadTurn(threadId: ThreadId): Promise<void> {
  await readNativeApi()?.orchestration.dispatchCommand({
    type: "thread.turn.interrupt",
    commandId: newCommandId(),
    threadId,
    createdAt: new Date().toISOString(),
  });
}

export async function stopWorkflowTask(threadId: ThreadId, taskId: string): Promise<void> {
  await readNativeApi()?.orchestration.dispatchCommand({
    type: "thread.task.stop",
    commandId: newCommandId(),
    threadId,
    taskId,
    createdAt: new Date().toISOString(),
  });
}

export async function backgroundSubagent(
  threadId: ThreadId,
  providerThreadId: string,
): Promise<void> {
  await readNativeApi()?.orchestration.dispatchCommand({
    type: "thread.task.background",
    commandId: newCommandId(),
    threadId,
    toolUseId: providerThreadId,
    createdAt: new Date().toISOString(),
  });
}

export function stopSubagent(threadId: ThreadId, providerThreadId: string): Promise<void> {
  return interruptThreadTurn(localSubagentThreadId(threadId, providerThreadId));
}

export async function undoTurnFiles(input: {
  thread: Thread | undefined;
  turnCounts: readonly number[];
  isReverting: boolean;
  isBusy: boolean;
  setIsReverting: (reverting: boolean) => void;
  setPendingFileUndo: (pending: PendingFileUndo | null) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}): Promise<void> {
  const api = readNativeApi();
  const {
    thread,
    turnCounts,
    isReverting,
    isBusy,
    setIsReverting,
    setPendingFileUndo,
    setThreadError,
  } = input;
  if (!api || !thread || isReverting || turnCounts.length === 0) return;
  if (isBusy) {
    setThreadError(thread.id, "Interrupt the current turn before undoing file changes.");
    return;
  }
  setIsReverting(true);
  setThreadError(thread.id, null);
  const orderedTurnCounts = [...new Set(turnCounts)].toSorted((left, right) => right - left);
  const requestedAt = new Date().toISOString();
  setPendingFileUndo({
    threadId: thread.id,
    turnCounts: orderedTurnCounts,
    existingFailureActivityIds: thread.activities
      .filter((activity) => activity.kind === "checkpoint.revert.failed")
      .map((activity) => activity.id),
  });
  try {
    for (const turnCount of orderedTurnCounts) {
      const preview = await api.orchestration.previewWorkspaceRestore({
        threadId: thread.id,
        target: { type: "undoFiles", turnCount },
      });
      const workspaceRestore = await confirmWorkspaceRestore(preview, api.dialogs.confirm);
      if (!workspaceRestore) {
        setPendingFileUndo(null);
        setIsReverting(false);
        return;
      }
      await api.orchestration.dispatchCommand({
        type: "thread.checkpoint.revert",
        workspaceRestore,
        commandId: newCommandId(),
        threadId: thread.id,
        turnCount,
        scope: "files",
        createdAt: requestedAt,
      });
    }
  } catch (error) {
    setPendingFileUndo(null);
    setIsReverting(false);
    setThreadError(
      thread.id,
      error instanceof Error ? error.message : "Failed to undo file changes.",
    );
  }
}
