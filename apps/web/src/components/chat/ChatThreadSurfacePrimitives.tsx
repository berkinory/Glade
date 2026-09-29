import type { ThreadId, TurnId } from "@glade/contracts";
import { lazy, Suspense, useEffect, useState } from "react";

import ChatView from "../ChatView";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../DiffPanelShell";
import type { DiffFileEditRequest } from "../../lib/diffEditBaseRev";
import type { SplitViewPanePanelState } from "../../splitViewModel";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import { scheduleDeferredChatMount } from "./deferredChatMount";

const DiffPanel = lazy(() => import("../DiffPanel"));
export const LazyBrowserPanel = lazy(() => import("../BrowserPanel"));
export const LazyDevicePanel = lazy(() => import("../DevicePanel"));

export const noopChatSurfaceAction = () => {};

function DiffLoadingFallback(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

export function LazyDiffPanel(props: {
  mode: DiffPanelMode;
  initialViewKind?: "repo" | "turn";
  threadId?: ThreadId | null;
  panelState?: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  onUpdatePanelState?: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onClosePanel?: () => void;
  liveRefreshEnabled?: boolean;
  queriesEnabled?: boolean;
  onEditFile?: (request: DiffFileEditRequest) => void;
}) {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel
          mode={props.mode}
          {...(props.initialViewKind ? { initialViewKind: props.initialViewKind } : {})}
          {...(props.threadId !== undefined ? { threadId: props.threadId } : {})}
          {...(props.panelState ? { panelState: props.panelState } : {})}
          {...(props.onUpdatePanelState ? { onUpdatePanelState: props.onUpdatePanelState } : {})}
          {...(props.onClosePanel ? { onClosePanel: props.onClosePanel } : {})}
          {...(props.liveRefreshEnabled !== undefined
            ? { liveRefreshEnabled: props.liveRefreshEnabled }
            : {})}
          {...(props.queriesEnabled !== undefined ? { queriesEnabled: props.queriesEnabled } : {})}
          {...(props.onEditFile ? { onEditFile: props.onEditFile } : {})}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
}

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
      <div className="opacity-0 [animation:chat-mount-loader-in_200ms_ease-out_150ms_forwards] motion-reduce:animate-none motion-reduce:opacity-100">
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
  onToggleBrowser: () => void;
  onToggleDevice?: () => void;
  onOpenBrowserUrl: (url: string) => void;
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
      onToggleBrowserPanel={props.onToggleBrowser}
      {...(props.onToggleDevice ? { onToggleDevicePanel: props.onToggleDevice } : {})}
      onOpenBrowserUrl={props.onOpenBrowserUrl}
      onOpenTurnDiffPanel={props.onOpenTurnDiff}
      {...(props.onSplitSurface ? { onSplitSurface: props.onSplitSurface } : {})}
      {...(props.onMaximize ? { onMaximizeSurface: props.onMaximize } : {})}
      {...(props.onChangeThread ? { onChangeThreadInSplitPane: props.onChangeThread } : {})}
    />
  );
}
