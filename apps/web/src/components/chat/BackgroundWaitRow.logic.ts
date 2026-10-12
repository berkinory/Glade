import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { subagentName } from "@glade/shared/threads/subagentName";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { resolveSubagentPresentation } from "~/lib/subagentPresentation";
import type { Thread } from "~/types";
import { localSubagentThreadId } from "../ChatView.selectors";

export type BackgroundWaitItem =
  | { readonly kind: "subagent"; readonly threadId: ThreadId; readonly name: string }
  | { readonly kind: "task"; readonly description: string };

const MAX_NAMED_ITEMS = 3;

// What a settled turn still waits on: background work that is running, and finished work whose
// result the agent has been woken to read.
export function deriveBackgroundWait(
  thread: Pick<Thread, "id" | "activities" | "backgroundWork">,
): readonly BackgroundWaitItem[] {
  const taskIds = [
    ...(thread.backgroundWork?.taskIds ?? []),
    ...(thread.backgroundWork?.awaitingReplyTaskIds ?? []),
  ];
  if (taskIds.length === 0) return [];
  const startedById = new Map<string, Record<string, unknown>>();
  for (const activity of thread.activities) {
    if (activity.kind !== "task.started") continue;
    const payload = asRecord(activity.payload);
    if (typeof payload?.taskId === "string") startedById.set(payload.taskId, payload);
  }
  return [...new Set(taskIds)].map((taskId): BackgroundWaitItem => {
    const started = startedById.get(taskId);
    const toolUseId = typeof started?.toolUseId === "string" ? started.toolUseId : null;
    if (started?.taskType === "local_agent" && toolUseId) {
      const threadId = localSubagentThreadId(thread.id, toolUseId);
      return {
        kind: "subagent",
        threadId,
        name: resolveSubagentPresentation({
          nickname: subagentName(toolUseId),
          fallbackId: threadId,
        }).primaryLabel,
      };
    }
    const description = typeof started?.detail === "string" ? started.detail.trim() : "";
    return { kind: "task", description };
  });
}

export function describeBackgroundWait(items: readonly BackgroundWaitItem[]): string {
  const [only] = items;
  if (items.length === 1 && only) {
    if (only.kind === "subagent") return `Waiting for ${only.name}`;
    return only.description ? `Waiting on “${only.description}”` : "Waiting on a background task";
  }
  const names = items.flatMap((item) => (item.kind === "subagent" ? [item.name] : []));
  if (names.length === items.length && names.length <= MAX_NAMED_ITEMS) {
    return `Waiting for ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  return `Waiting on ${items.length} background tasks`;
}
