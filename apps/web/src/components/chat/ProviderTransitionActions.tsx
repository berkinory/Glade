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
    handoff.bootstrapStatus === "completed" ||
    handoff.stage === "cancelled"
  )
    return null;
  const canPrepare =
    ["ready", "failed"].includes(handoff.stage ?? "") && !handoff.deliveryMessageId;
  const run = async (action: "prepare" | "stop") => {
    const api = readNativeApi();
    if (!api) return;
    setBusy(true);
    try {
      if (action === "prepare") await api.orchestration.prepareHandoff({ threadId });
      else
        await api.orchestration.dispatchCommand({
          type: "thread.turn.interrupt",
          commandId: newCommandId(),
          threadId,
          createdAt: new Date().toISOString(),
        });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: action === "prepare" ? "Could not prepare transition" : "Could not stop transition",
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {canPrepare ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            void run("prepare");
          }}
        >
          Prepare context
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          void run("stop");
        }}
      >
        Stop transition
      </Button>
    </div>
  );
}
