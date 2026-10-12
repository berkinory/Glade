import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { isProviderDeliveryBlockDetail } from "@glade/shared/provider/providerDeliveryBlock";
import { useEffect, useRef } from "react";

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
  errorsByThreadId: ReadonlyMap<ThreadId, string>;
  visibleThreadIds: ReadonlySet<ThreadId>;
  hydrated: boolean;
  onOpen: (threadId: ThreadId) => void;
}): void {
  const { errorsByThreadId, visibleThreadIds, hydrated, onOpen } = input;
  const previous = useRef<ReadonlyMap<ThreadId, string> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (previous.current) {
      for (const [threadId] of previous.current) {
        if (!errorsByThreadId.has(threadId) || visibleThreadIds.has(threadId))
          toastManager.close(threadErrorToastId(threadId));
      }
      for (const [threadId, error] of errorsByThreadId) {
        if (visibleThreadIds.has(threadId) || previous.current.get(threadId) === error) continue;
        toastManager.add({
          ...buildThreadErrorToastOptions({ error, threadId, onClose: () => {} }),
          data: { copyText: error, threadId, allowCrossThreadVisibility: true },
          actionProps: { children: "Open chat", onClick: () => onOpen(threadId) },
        });
      }
    }
    previous.current = errorsByThreadId;
  }, [errorsByThreadId, visibleThreadIds, hydrated, onOpen]);
  useEffect(
    () => () => {
      for (const [threadId] of previous.current ?? [])
        toastManager.close(threadErrorToastId(threadId));
    },
    [],
  );
}
