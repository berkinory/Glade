import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isProviderDeliveryBlockDetail } from "@glade/shared/provider/providerDeliveryBlock";
import { useEffect, useRef } from "react";

import type { Thread } from "~/types";
import { toastManager } from "../ui/toast";

type ThreadErrorToastOptions = Parameters<typeof toastManager.add>[0];

function threadErrorToastId(threadId: ThreadId): string {
  return `thread-error:${threadId}`;
}

function threadErrorToastTitle(error: string): string {
  if (isProviderDeliveryBlockDetail(error)) {
    return "This chat is blocked by an earlier provider error.";
  }
  const firstLine = error.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const title =
    firstLine
      .replace(/^Error:\s*/u, "")
      .replace(/^Provider adapter process error \([^)]+\) for thread [^:]+:\s*/u, "") ||
    "This task failed.";
  return title.length > 180 ? `${title.slice(0, 179).trimEnd()}…` : title;
}

function buildThreadErrorToastOptions(input: {
  error: string;
  onClose: () => void;
  threadId: ThreadId;
}): ThreadErrorToastOptions {
  return {
    id: threadErrorToastId(input.threadId),
    type: "error",
    title: threadErrorToastTitle(input.error),
    timeout: 0,
    priority: "high",
    onClose: input.onClose,
    data: { copyText: input.error, threadId: input.threadId },
  };
}

export function useThreadErrorNotifications(input: {
  threads: readonly Thread[];
  visibleThreadIds: ReadonlySet<ThreadId>;
  hydrated: boolean;
  onOpen: (threadId: ThreadId) => void;
}): void {
  const previous = useRef<Map<ThreadId, string | null> | null>(null);
  useEffect(() => {
    if (!input.hydrated) return;
    const errors = new Map(input.threads.map((thread) => [thread.id, thread.error]));
    if (previous.current) {
      for (const [threadId] of previous.current) {
        if (!errors.get(threadId) || input.visibleThreadIds.has(threadId))
          toastManager.close(threadErrorToastId(threadId));
      }
      for (const thread of input.threads) {
        if (
          !thread.error ||
          input.visibleThreadIds.has(thread.id) ||
          previous.current.get(thread.id) === thread.error
        )
          continue;
        toastManager.add({
          ...buildThreadErrorToastOptions({
            error: thread.error,
            threadId: thread.id,
            onClose: () => {},
          }),
          data: { copyText: thread.error, threadId: thread.id, allowCrossThreadVisibility: true },
          actionProps: { children: "Open chat", onClick: () => input.onOpen(thread.id) },
        });
      }
    }
    previous.current = errors;
  }, [input]);
  useEffect(
    () => () => {
      for (const [threadId] of previous.current ?? [])
        toastManager.close(threadErrorToastId(threadId));
    },
    [],
  );
}
