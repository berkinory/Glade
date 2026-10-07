import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";

import ChatView from "../ChatView";
import type { SplitViewPanePanelState } from "../../splitViewModel";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import { scheduleDeferredChatMount } from "./deferredChatMount";

export const noopChatSurfaceAction = () => {};

export function ChatMountLoader() {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 items-center justify-center text-foreground [contain:layout_style_paint]",
        CHAT_BACKGROUND_CLASS_NAME,
      )}
    >
      {}
      <style>{`@keyframes chat-mount-loader-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div className="opacity-0 [animation:chat-mount-loader-in_120ms_ease-out_150ms_forwards] motion-reduce:animate-none motion-reduce:opacity-100">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    </div>
  );
}

export function DeferredChatView(props: {
  threadId: ThreadId;
  hideHeader?: boolean;
  paneScopeId: string;
  deferMount: boolean;
  surfaceMode: "single" | "split";
  isFocusedPane: boolean;
  panelState: SplitViewPanePanelState;
  onToggleDiff: () => void;
  onToggleRightDock?: () => void;
  onToggleTerminal?: () => void;
  onOpenTerminal?: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onSplitSurface?: () => void;
  onMaximize?: () => void;
  onChangeThread?: () => void;
  onMounted?: () => void;
}) {
  const onMounted = props.onMounted ?? noopChatSurfaceAction;
  const mountKey = `${props.paneScopeId}:${props.threadId}`;
  const [readyMountKey, setReadyMountKey] = useState<string | null>(() =>
    props.deferMount ? null : mountKey,
  );
  const canMountChatView = !props.deferMount || readyMountKey === mountKey;

  useEffect(() => {
    if (!props.deferMount) {
      return;
    }
    // readyMountKey is keyed by mountKey, so a changed mountKey already makes canMountChatView false
    // (loader) without an eager reset here; the double rAF then stamps the new key once the paint has
    // settled. Chromium can suppress animation frames while an Electron window is starting or being
    // background-throttled, so keep a bounded fallback: a deferred draft must never remain on the mount
    // loader forever just because frames did not run.
    return scheduleDeferredChatMount(window, () => setReadyMountKey(mountKey));
  }, [mountKey, props.deferMount]);

  useEffect(() => {
    if (canMountChatView) {
      onMounted();
    }
  }, [canMountChatView, onMounted]);

  if (!canMountChatView) {
    return <ChatMountLoader />;
  }

  return (
    <ChatView
      key={props.paneScopeId}
      threadId={props.threadId}
      hideHeader={props.hideHeader ?? false}
      paneScopeId={props.paneScopeId}
      surfaceMode={props.surfaceMode}
      isFocusedPane={props.isFocusedPane}
      panelState={props.panelState}
      onToggleDiffPanel={props.onToggleDiff}
      {...(props.onToggleRightDock ? { onToggleRightDock: props.onToggleRightDock } : {})}
      {...(props.onToggleTerminal ? { onToggleTerminal: props.onToggleTerminal } : {})}
      {...(props.onOpenTerminal ? { onOpenTerminal: props.onOpenTerminal } : {})}
      onOpenTurnDiffPanel={props.onOpenTurnDiff}
      {...(props.onSplitSurface ? { onSplitSurface: props.onSplitSurface } : {})}
      {...(props.onMaximize ? { onMaximizeSurface: props.onMaximize } : {})}
      {...(props.onChangeThread ? { onChangeThreadInSplitPane: props.onChangeThread } : {})}
    />
  );
}
