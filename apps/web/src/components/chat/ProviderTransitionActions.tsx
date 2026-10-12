import { useState } from "react";
import type { CommandId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import { readNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";
import { useChatThreadContext } from "./ChatThreadContext";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export function ProviderTransitionActions({ operationId }: { operationId: CommandId }) {
  const { threadId } = useChatThreadContext();
  const handoff = useStore((state) => state.threadShellById?.[threadId]?.handoff);
  const [busy, setBusy] = useState(false);
  if (
    handoff?.operationId !== operationId ||
    (handoff.stage !== "pending" && handoff.stage !== "uncertain")
  )
    return null;
  const cancel = async () => {
    const api = readNativeApi();
    if (!api) return;
    setBusy(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.handoff.cancel",
        commandId: newCommandId(),
        threadId,
        operationId,
        createdAt: new Date().toISOString(),
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not cancel the switch",
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>
        {handoff.stage === "pending" ? "Switch back" : "Dismiss"}
      </Button>
    </div>
  );
}
