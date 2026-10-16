import { useState } from "react";

import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadHandoff } from "@glade/contracts/orchestration/threadEntities";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { useComposerDraftStore } from "~/composerDraftStore";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import { COMPOSER_INLINE_ACTION_PILL_CLASS_NAME } from "./composerPickerStyles";
import { COMPOSER_NOTICE_CONTENT_CLASS_NAME } from "./composerStackedPanelStyles";

// The source session keeps running until the next send parks it, which stops its live tasks. The
// switch itself stays instant; this only says what that send will cost and offers the undo.
export function ComposerProviderSwitchNotice({
  threadId,
  handoff,
  runningTaskCount,
}: {
  threadId: ThreadId;
  handoff: ThreadHandoff;
  runningTaskCount: number;
}) {
  const [undoing, setUndoing] = useState(false);
  const source = PROVIDER_DISPLAY_NAMES[handoff.sourceModelSelection.provider];
  const destination = PROVIDER_DISPLAY_NAMES[handoff.destinationModelSelection.provider];
  const tasks =
    runningTaskCount === 1 ? "1 background task" : `${runningTaskCount} background tasks`;

  const switchBack = async () => {
    const api = readNativeApi();
    if (!api || undoing) return;
    setUndoing(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.handoff.cancel",
        commandId: newCommandId(),
        threadId,
        operationId: handoff.operationId,
        createdAt: new Date().toISOString(),
      });
      useComposerDraftStore
        .getState()
        .setModelSelectionAndSticky(threadId, handoff.sourceModelSelection);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not switch provider",
        description:
          error instanceof Error
            ? error.message
            : `Could not switch back to ${source}. Try again in a moment.`,
      });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="pb-2">
      <ComposerStackedPanel
        detached
        role="status"
        aria-live="polite"
        className={`${COMPOSER_NOTICE_CONTENT_CLASS_NAME} flex items-center gap-2 text-muted-foreground`}
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="min-w-0 flex-1">
          {source} still has {tasks} running. Sending your next message continues with {destination}{" "}
          and stops {runningTaskCount === 1 ? "it" : "them"}.
        </span>
        <button
          type="button"
          className={COMPOSER_INLINE_ACTION_PILL_CLASS_NAME}
          disabled={undoing}
          onClick={() => void switchBack()}
        >
          Switch back to {source}
        </button>
      </ComposerStackedPanel>
    </div>
  );
}
