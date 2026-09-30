import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Schema } from "effect";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useRef,
  useState,
} from "react";

import type { ChatRightPanel } from "../../diffRouteSearch";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  attachPanelPointerOverlaySession,
  canComposerHandlePanelWidth,
  createPanelResizeOverlay,
  removePanelResizeOverlay,
} from "../../lib/panelResize";
import type { PaneId, SplitViewId, SplitViewPanePanelState } from "../../splitViewModel";
import { LazyBrowserPanel, LazyDiffPanel } from "./ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "./PanelStateMessage";

const SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX = 22 * 16;
const BROWSER_SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX = 30 * 16;
const SPLIT_PANE_CHAT_MIN_WIDTH = 20 * 16;
const SINGLE_PANEL_MIN_WIDTH = 26 * 16;
const BROWSER_PANEL_MIN_WIDTH = 21 * 16;
const RIGHT_PANEL_SIDEBAR_WIDTH_STORAGE_KEY = "chat_right_panel_width";
// Split panes cannot reuse the desktop Sidebar primitive because it positions the panel against the
// viewport. This embedded shell keeps browser/diff content anchored to the pane.
export function SplitPaneEmbeddedPanel(props: {
  splitViewId: SplitViewId;
  paneId: PaneId;
  paneScopeId: string;
  panelOpen: boolean;
  panel: ChatRightPanel | null | undefined;
  threadId: ThreadId | null;
  onClosePanel: () => void;
  panelState: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  isFocused: boolean;
  onUpdatePanelState: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelWidthStorageKey =
    props.panel === "browser" ? "browser" : props.panel === "diff" ? "diff" : "panel";
  const storageKey = `${RIGHT_PANEL_SIDEBAR_WIDTH_STORAGE_KEY}:${props.splitViewId}:${props.paneId}:${panelWidthStorageKey}`;
  const defaultPanelWidth =
    props.panel === "browser"
      ? BROWSER_SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX
      : SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX;
  const minPanelWidth =
    props.panel === "browser" ? BROWSER_PANEL_MIN_WIDTH : SINGLE_PANEL_MIN_WIDTH;

  const [panelWidthState, setPanelWidthState] = useState<{ key: string; value: number }>(() => ({
    key: storageKey,
    value: getLocalStorageItem(storageKey, Schema.Finite) ?? defaultPanelWidth,
  }));
  const panelWidth =
    panelWidthState.key === storageKey
      ? panelWidthState.value
      : (getLocalStorageItem(storageKey, Schema.Finite) ?? defaultPanelWidth);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const wrapper = wrapperRef.current;
    const parent = wrapper?.parentElement;
    if (!wrapper || !parent) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    const maxWidth = Math.max(minPanelWidth, parent.clientWidth - SPLIT_PANE_CHAT_MIN_WIDTH);
    const resizeOverlay = createPanelResizeOverlay();
    let detachPointerSession = () => {};
    let pendingWidth = startWidth;
    let currentWidth = startWidth;
    let frameId = 0;
    let finished = false;

    const applyPendingWidth = () => {
      frameId = 0;
      if (pendingWidth === currentWidth) return;
      if (pendingWidth < currentWidth) {
        currentWidth = pendingWidth;
        wrapper.style.width = `${currentWidth}px`;
        return;
      }
      const accepted = canComposerHandlePanelWidth({
        nextWidth: pendingWidth,
        paneScopeId: props.paneScopeId,
        applyWidth: (width) => {
          wrapper.style.width = `${width}px`;
        },
        resetWidth: () => {
          wrapper.style.width = `${currentWidth}px`;
        },
      });
      if (!accepted) return;
      currentWidth = pendingWidth;
      wrapper.style.width = `${currentWidth}px`;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      pendingWidth = Math.max(minPanelWidth, Math.min(maxWidth, startWidth + delta));
      if (frameId === 0) frameId = window.requestAnimationFrame(applyPendingWidth);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      applyPendingWidth();
      detachPointerSession();
      removePanelResizeOverlay(resizeOverlay);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      if (currentWidth !== startWidth) {
        setPanelWidthState({ key: storageKey, value: currentWidth });
        setLocalStorageItem(storageKey, currentWidth, Schema.Finite);
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    detachPointerSession = attachPanelPointerOverlaySession(resizeOverlay, {
      onMove: onPointerMove,
      onRelease: finish,
      onAbort: finish,
    });
  };

  if (!props.panelOpen || !props.threadId) {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      data-native-browser-surface={props.panel === "browser" ? "true" : undefined}
      className="relative flex h-full min-h-0 min-w-0 flex-none border-l border-[var(--app-surface-divider)] bg-card text-foreground"
      style={
        {
          width: `${panelWidth}px`,
          maxWidth: `calc(100% - ${SPLIT_PANE_CHAT_MIN_WIDTH}px)`,
          minWidth: minPanelWidth,
        } as CSSProperties
      }
    >
      <div
        className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--app-surface-divider)]"
        onPointerDown={startResize}
      />
      {props.panel === "browser" ? (
        <Suspense fallback={<PanelStateMessage loadingLabel="Loading browser" />}>
          <LazyBrowserPanel
            mode="sidebar"
            threadId={props.threadId}
            onClosePanel={props.onClosePanel}
          />
        </Suspense>
      ) : (
        <LazyDiffPanel
          mode="sidebar"
          threadId={props.threadId}
          onClosePanel={props.onClosePanel}
          panelState={props.panelState}
          liveRefreshEnabled={props.isFocused}
          onUpdatePanelState={props.onUpdatePanelState}
        />
      )}
    </div>
  );
}
