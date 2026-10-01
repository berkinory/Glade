import { useState } from "react";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import { readNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";

export function HandoffPreparationNotice({ threadId }: { threadId: string }) {
  const id = ThreadId.makeUnsafe(threadId);
  const handoff = useStore((state) => state.threadShellById?.[id]?.handoff);
  const activity = useStore((state) =>
    Object.values(state.activityByThreadId?.[id] ?? {})
      .filter((activity) => activity.kind.startsWith("handoff.preparation."))
      .toSorted((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
      .at(-1),
  );
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!handoff || handoff.bootstrapStatus === "completed") return null;
  const preparing =
    activity?.kind === "handoff.preparation.started" ||
    activity?.kind === "handoff.preparation.pass" ||
    activity?.kind === "handoff.preparation.request";
  const retry = async () => {
    const api = readNativeApi();
    if (!api) return;
    setError(null);
    try {
      await api.orchestration.prepareHandoff({ threadId: id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare handoff context.");
    }
  };
  const cancel = async () => {
    const api = readNativeApi();
    if (!api) return;
    setCancelling(true);
    setError(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: id,
        createdAt: new Date().toISOString(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel preparation.");
    } finally {
      setCancelling(false);
    }
  };
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-ui-sm"
      role="status"
    >
      <span className="min-w-0 flex-1 text-muted-foreground">
        {error ??
          (preparing
            ? "Preparing handoff context with your destination model…"
            : activity?.kind === "handoff.preparation.failed" ||
                activity?.kind === "handoff.preparation.cancelled"
              ? "Handoff preparation did not finish. Your draft is intact; send again to retry."
              : handoff.preparation
                ? "Handoff context is ready. Send to continue."
                : "Your first send prepares context with the destination model before continuing.")}
      </span>
      {preparing ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={cancelling}
          onClick={() => {
            void cancel();
          }}
        >
          Cancel
        </Button>
      ) : !handoff.preparation ||
        activity?.kind === "handoff.preparation.failed" ||
        activity?.kind === "handoff.preparation.cancelled" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void retry();
          }}
        >
          Prepare context
        </Button>
      ) : null}
    </div>
  );
}
