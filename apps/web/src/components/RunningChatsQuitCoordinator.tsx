import { useCallback, useEffect, useRef, useState } from "react";

import {
  listRunningChatsFromDesktopStore,
  type RunningChatQuitSummary,
} from "~/lib/runningChatsQuitConfirmation";
import { stopLocalRunningChats } from "~/lib/stopRunningChats";
import { useStore } from "~/store";

import { RunningChatsQuitDialog, type RunningChatsQuitDecision } from "./RunningChatsQuitDialog";

export function RunningChatsQuitCoordinator() {
  const [chats, setChats] = useState<ReadonlyArray<RunningChatQuitSummary> | null>(null);

  const [quitting, setQuitting] = useState(false);
  const pendingRequestIdRef = useRef<string | null>(null);

  const settle = useCallback(
    (decision: RunningChatsQuitDecision | null) => {
      const requestId = pendingRequestIdRef.current;
      if (!requestId) {
        return;
      }
      const allow = decision != null;
      const chatsToStop = allow ? chats : null;
      pendingRequestIdRef.current = null;
      if (!decision?.resume) {
        setChats(null);
      }

      const reply = (allowQuit: boolean) => {
        window.desktopBridge?.replyQuitConfirmation({
          requestId,
          phase: "decision",
          allow: allowQuit,
        });
      };

      if (!allow || chatsToStop == null || chatsToStop.length === 0) {
        reply(allow);
        return;
      }

      const stopped = stopLocalRunningChats(chatsToStop, decision.resume);

      if (decision.resume) {
        setQuitting(true);
        void stopped.finally(() => {
          reply(true);
          setQuitting(false);
          setChats(null);
        });
        return;
      }

      void stopped;
      reply(true);
    },
    [chats],
  );

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitConfirmationRequest;
    const reply = window.desktopBridge?.replyQuitConfirmation;
    if (typeof subscribe !== "function" || typeof reply !== "function") {
      return;
    }

    return subscribe((request) => {
      const state = useStore.getState();
      // An unhydrated store is not proof that nothing runs. Leaving the request unanswered lets the
      // desktop host fall back to its native confirmation.
      if (!state.threadsHydrated) return;
      const running = listRunningChatsFromDesktopStore(state);
      if (running.length === 0) {
        reply({ requestId: request.requestId, phase: "decision", allow: true });
        return;
      }

      reply({
        requestId: request.requestId,
        phase: "ready",
        runningCount: running.length,
        chats: running,
      });
      pendingRequestIdRef.current = request.requestId;
      setChats(running);
    });
  }, []);

  return (
    <RunningChatsQuitDialog
      chats={chats}
      quitting={quitting}
      onStay={() => settle(null)}
      onQuit={settle}
    />
  );
}
