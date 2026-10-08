import { useEffect, useState, useSyncExternalStore } from "react";

import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Spinner } from "~/components/ui/spinner";
import { getConnectionStatus, subscribeConnectionStatus } from "~/connectionStatus";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { retryThreadDetailSync } from "~/threadDetailSyncRetry";
import { addWsTransportStateListener, type WsTransportState } from "~/wsTransportEvents";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import { resolveConnectionNotice } from "./ComposerConnectionNotice.logic";
import { COMPOSER_INLINE_ACTION_PILL_CLASS_NAME } from "./composerPickerStyles";
import { COMPOSER_NOTICE_CONTENT_CLASS_NAME } from "./composerStackedPanelStyles";

// Short drops recover before anyone notices; recovery clears the notice at once.
const RECONNECT_NOTICE_DELAY_MS = 1_500;

function useTransportState() {
  const [state, setState] = useState<WsTransportState | null>(null);
  const [reconnectNoticeDue, setReconnectNoticeDue] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = addWsTransportStateListener(
      (next) => {
        setState(next);
        if (next === "connecting" || next === "closed") {
          // Closed and connecting alternate during one outage; keep the first deadline.
          timer ??= window.setTimeout(() => setReconnectNoticeDue(true), RECONNECT_NOTICE_DELAY_MS);
          return;
        }
        window.clearTimeout(timer);
        timer = undefined;
        setReconnectNoticeDue(false);
      },
      { replayCurrent: true },
    );
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
  return { state, reconnectNoticeDue };
}

// Lives outside the editor so it never takes focus or touches the draft, and outside the
// transcript so it is not an activity signal for auto-follow.
export function ComposerConnectionNotice({
  threadId,
  transcriptShowsSyncFailure,
}: {
  threadId: ThreadId;
  transcriptShowsSyncFailure: boolean;
}) {
  const transport = useTransportState();
  const status = useSyncExternalStore(
    subscribeConnectionStatus,
    getConnectionStatus,
    getConnectionStatus,
  );
  const threadSyncFailed = useStore((state) => state.threadDetailSyncById?.[threadId] === "failed");
  const notice = resolveConnectionNotice({
    transportState: transport.state,
    reconnectNoticeDue: transport.reconnectNoticeDue,
    status,
    threadUpdatesPaused: threadSyncFailed && !transcriptShowsSyncFailure,
  });
  if (notice === null) return null;

  const retry =
    notice.kind === "thread-paused"
      ? () => retryThreadDetailSync(threadId)
      : notice.kind === "workspace-paused"
        ? () =>
            void readNativeApi()
              ?.orchestration.subscribeShell()
              .catch(() => undefined)
        : null;
  const waiting =
    notice.kind === "reconnecting" || notice.kind === "unresponsive" || notice.kind === "slow";
  return (
    <div className="pb-2">
      <ComposerStackedPanel
        detached
        role="status"
        aria-live="polite"
        className={`${COMPOSER_NOTICE_CONTENT_CLASS_NAME} flex items-center gap-2 text-muted-foreground`}
      >
        {waiting ? (
          <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
        ) : (
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${notice.kind === "recovered" ? "bg-success" : "bg-warning"}`}
          />
        )}
        <span className="min-w-0 flex-1">{notice.message}</span>
        {retry ? (
          <button type="button" className={COMPOSER_INLINE_ACTION_PILL_CLASS_NAME} onClick={retry}>
            Retry updates
          </button>
        ) : null}
      </ComposerStackedPanel>
    </div>
  );
}
