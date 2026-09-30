import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { localSubagentThreadId } from "~/components/ChatView.selectors";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

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
