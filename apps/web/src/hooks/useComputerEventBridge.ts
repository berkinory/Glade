import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { computerActionStatusLabel } from "~/components/ComputerPanel.logic";
import {
  changedThreadComputerStates,
  removedThreadComputerStateIds,
} from "~/components/chat/ComputerPreviewPopover.logic";
import { type DesktopBridge, ThreadId } from "@glade/contracts";
import { readLocalComputerPermissionBridge } from "~/lib/computerProvisioning";
import { serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useComputerPreviewStore } from "../computerPreviewStore";
import { useComputerStateStore } from "../computerStateStore";

export function subscribeComputerPermissionStatus(
  queryClient: QueryClient,
  bridge: Pick<
    DesktopBridge["computerPermissions"],
    "onState"
  > | null = readLocalComputerPermissionBridge(),
): () => void {
  if (!bridge) return () => undefined;
  let previous: string | undefined;
  return bridge.onState((state) => {
    // ComputerPermission-only snapshots do not establish Accessibility and must not turn an unused
    // Computer feature on. Only refresh an already requested status.
    if (
      !state.supported ||
      state.platform !== "macos" ||
      state.accessibilityPermission === undefined
    )
      return;
    const grants = [
      state.accessibilityPermission,
      state.inputMonitoringPermission,
      state.screenRecordingPermission,
    ].join(",");
    if (grants === previous) return;
    previous = grants;
    if (queryClient.getQueryState(serverQueryKeys.computerStatus())) {
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.computerStatus() });
    }
  });
}

export function useComputerEventBridge(): void {
  const queryClient = useQueryClient();
  useEffect(() => subscribeComputerPermissionStatus(queryClient), [queryClient]);
  useEffect(() => {
    const api = ensureNativeApi();
    if (!api.computer) {
      return;
    }
    const unsubscribe = api.computer.onEvent((event) => {
      const store = useComputerStateStore.getState();
      const preview = useComputerPreviewStore.getState();
      switch (event.type) {
        case "computer.thread-state":
          store.upsertThreadState(event.state);
          break;
        case "computer.windows-changed":
          store.applyWindowsChanged(event.windows);
          break;
        case "computer.action": {
          store.recordAction(event);
          const threadId = event.threadId;
          if (threadId) {
            const label = computerActionStatusLabel(
              event,
              store.threadStatesByThreadId[threadId]?.windows,
            );
            if (label !== null) {
              preview.noteThreadActionLabel(threadId, label);
            }
          }
          break;
        }
        case "computer.open-pane-requested":
          preview.requestPreviewSurface(event.threadId);
          break;
        case "computer.input-stopped":
          store.setInputStopped(event.stopped);
          void queryClient.invalidateQueries({
            queryKey: serverQueryKeys.computerStatus(),
          });
          break;
        case "computer.frame":
          break;
      }
    });

    const unsubscribeThreadStates = useComputerStateStore.subscribe((state, previous) => {
      const nextStates = state.threadStatesByThreadId;
      if (nextStates === previous.threadStatesByThreadId) {
        return;
      }
      const preview = useComputerPreviewStore.getState();
      if (Object.keys(nextStates).length === 0) {
        if (Object.keys(previous.threadStatesByThreadId).length > 0) {
          preview.clear();
        }
        return;
      }
      for (const threadState of changedThreadComputerStates(
        nextStates,
        previous.threadStatesByThreadId,
      )) {
        preview.noteThreadComputerState(threadState);
      }
      for (const threadId of removedThreadComputerStateIds(
        nextStates,
        previous.threadStatesByThreadId,
      )) {
        preview.removePreviewSession(ThreadId.makeUnsafe(threadId));
      }
    });
    return () => {
      unsubscribe();
      unsubscribeThreadStates();
    };
  }, [queryClient]);
}
