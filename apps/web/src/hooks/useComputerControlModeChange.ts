import { useCallback, useEffect, useRef } from "react";
import type { ThreadId } from "@glade/contracts";
import type { ComposerComputerControlMode } from "~/computerControlMode";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";
import {
  prepareComputerPermissionGuide,
  readLocalComputerPermissionBridge,
} from "~/lib/computerProvisioning";

/** Explicit activation opens the native permission guide when grants are missing. */
export function useComputerControlModeChange({
  threadId,
  setMode,
  focusComposer,
}: {
  threadId: ThreadId;
  setMode: (
    threadId: ThreadId,
    mode: ComposerComputerControlMode,
    options: { revokeQueued: boolean; generation: number },
  ) => void;
  focusComposer: () => void;
}) {
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [threadId],
  );
  const change = useCallback(
    (mode: ComposerComputerControlMode) => {
      const api = readNativeApi();
      if (!api) return;
      const request = ++sequence.current;
      const current = () => request === sequence.current;
      let settingUp = false;
      void (async () => {
        const result = await api.computer.setControlEnabled({ threadId, enabled: mode !== "off" });
        if (!current()) return;
        setMode(threadId, result.enabled ? mode : "off", {
          revokeQueued: mode === "off",
          generation: result.generation ?? 0,
        });
        // Enabling against a reset server generation leaves control off: the
        // queued intent it would have armed is stale, so say so plainly.
        if (mode !== "off" && !result.enabled && current()) {
          toastManager.add({
            title: "Computer control was reset",
            description: "Control was reset — invoke /computer-use again for a new task.",
            type: "error",
          });
        }
        const computerPermission = readLocalComputerPermissionBridge();
        if (result.enabled && computerPermission) {
          settingUp = true;
          const ready = await prepareComputerPermissionGuide({
            getPermissionState: (kinds) => computerPermission.getState(kinds),
            startPermissionSetup: (kinds) => computerPermission.startPermissionSetup(kinds),
            isCurrent: current,
          });
          if (!ready) return; // Keep Settings/its floating guide in front.
        }
        if (current()) focusComposer();
      })().catch((error) => {
        if (!current()) return;
        toastManager.add({
          title: settingUp
            ? "Computer permission setup could not start"
            : "Computer control could not be changed",
          description: String(error),
          type: "error",
        });
      });
    },
    [threadId, setMode, focusComposer],
  );
  return { change, sequence };
}
