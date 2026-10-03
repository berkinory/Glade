import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import type { ThreadFindHighlightStore } from "./threadFind.logic";

export interface ImportedHistoryState {
  readonly loading: boolean;
  readonly searching: boolean;
  readonly error: string | null;
  readonly loadOlder: () => void;
  readonly retry: () => void;
}

interface HistoryReadOwner {
  readonly threadId: ThreadId;
  beforeMessageId: MessageId | undefined;
  cursor: string | null;
  initialized: boolean;
  pending: Promise<boolean> | null;
}

export function useImportedHistory(
  threadId: ThreadId,
  find: ThreadFindHighlightStore,
): ImportedHistoryState {
  const firstMessageId = useStore((state) => state.messageIdsByThreadId?.[threadId]?.[0]);
  const query = useSyncExternalStore(
    find.subscribe,
    () => find.get()?.query.trim() ?? "",
    () => "",
  );
  const owner = useRef<HistoryReadOwner>({
    threadId,
    beforeMessageId: undefined,
    cursor: null,
    initialized: false,
    pending: null,
  });
  const attached = useRef(true);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    attached.current = true;
    owner.current = {
      threadId,
      beforeMessageId: undefined,
      cursor: null,
      initialized: false,
      pending: null,
    };
    setReady(false);
    setLoading(false);
    setHasOlder(false);
    setError(null);
    return () => {
      attached.current = false;
    };
  }, [threadId]);

  // The callback belongs to LegendList's external scroll subscription; one owner serializes every caller.
  const loadPage = useCallback((limit: number): Promise<boolean> => {
    const current = owner.current;
    if (current.pending) return current.pending;
    if (!current.cursor || !current.beforeMessageId) return Promise.resolve(false);
    setLoading(true);
    const cursor = current.cursor;
    const pending = ensureNativeApi()
      .orchestration.readImportedHistory({
        threadId: current.threadId,
        beforeMessageId: current.beforeMessageId,
        cursor,
        limit,
      })
      .then((result) => {
        if (!attached.current || owner.current !== current) return false;
        if (
          result.nextCursor === cursor ||
          (result.messages.length === 0 && result.nextCursor !== null)
        )
          throw new Error("History did not advance. Reopen the conversation and retry.");
        current.cursor = result.nextCursor;
        setHasOlder(result.nextCursor !== null);
        useStore.getState().prependImportedHistory(current.threadId, result.messages);
        setError(null);
        return result.messages.length > 0;
      })
      .catch((cause: unknown) => {
        if (attached.current && owner.current === current)
          setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      })
      .finally(() => {
        current.pending = null;
        if (attached.current && owner.current === current) setLoading(false);
      });
    current.pending = pending;
    return pending;
  }, []);

  useEffect(() => {
    const current = owner.current;
    if (!firstMessageId || current.initialized) return;
    current.initialized = true;
    current.beforeMessageId = firstMessageId;
    void ensureNativeApi()
      .orchestration.readImportedHistory({
        threadId,
        beforeMessageId: firstMessageId,
        cursor: null,
        probe: true,
      })
      .then(async (result) => {
        if (!attached.current || owner.current !== current) return;
        current.cursor = result.nextCursor;
        setHasOlder(result.nextCursor !== null);
        const loaded =
          useStore
            .getState()
            .messageIdsByThreadId?.[threadId]?.filter((id) => id.startsWith("import:")).length ?? 0;
        if (current.cursor && loaded < 25) await loadPage(Math.min(25 - loaded, 100));
        if (attached.current && owner.current === current) setReady(true);
      })
      .catch((cause: unknown) => {
        if (attached.current && owner.current === current)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [firstMessageId, threadId, retryNonce, loadPage]);

  useEffect(() => {
    if (!query || !ready || error) return;
    let cancelled = false;
    void (async () => {
      while (owner.current.cursor) {
        if (cancelled) break;
        if (!(await loadPage(100))) break;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, ready, threadId, retryNonce, loadPage, error]);

  const loadOlder = () => {
    if (ready && !error) void loadPage(100);
  };
  const retry = () => {
    setError(null);
    if (!ready) owner.current.initialized = false;
    else if (!query) void loadPage(100);
    setRetryNonce((value) => value + 1);
  };
  return { loading, searching: query.length > 0 && (!ready || hasOlder), error, loadOlder, retry };
}
