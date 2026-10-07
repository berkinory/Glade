import { DockExplorerPane } from "./DockExplorerPane";
import { SplitSourceControl } from "./SplitSourceControl";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { CSSProperties } from "react";

import type { ChatRightPanel } from "../../diffRouteSearch";
import type { PaneId, SplitViewId, SplitViewPanePanelState } from "../../splitViewModel";
import { PanelWidthResizeHandle, usePanelWidthResize } from "./usePanelWidthResize";

const SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX = 22 * 16;
const SPLIT_PANE_CHAT_MIN_WIDTH = 20 * 16;
const SINGLE_PANEL_MIN_WIDTH = 26 * 16;
const RIGHT_PANEL_SIDEBAR_WIDTH_STORAGE_KEY = "chat_right_panel_width";
// Split panes cannot reuse the desktop Sidebar primitive because it positions the panel against the
// viewport. This embedded shell keeps explorer/diff content anchored to the pane.
export function SplitPaneEmbeddedPanel(props: {
  explorerOpen: boolean;
  workspaceRoot: string | null;
  splitViewId: SplitViewId;
  paneId: PaneId;
  paneScopeId: string;
  panelOpen: boolean;
  panel: ChatRightPanel | null | undefined;
  threadId: ThreadId | null;
  panelState: Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">;
  isFocused: boolean;
  onUpdatePanelState: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
}) {
  const panelWidthStorageKey = props.panel === "diff" ? "diff" : "panel";
  const {
    wrapperRef,
    width: panelWidth,
    startResize,
  } = usePanelWidthResize({
    storageKey: `${RIGHT_PANEL_SIDEBAR_WIDTH_STORAGE_KEY}:${props.splitViewId}:${props.paneId}:${panelWidthStorageKey}`,
    defaultWidth: SPLIT_PANE_PANEL_DEFAULT_WIDTH_PX,
    minWidth: SINGLE_PANEL_MIN_WIDTH,
    chatMinWidth: SPLIT_PANE_CHAT_MIN_WIDTH,
    paneScopeId: props.paneScopeId,
  });
  if (!props.panelOpen || !props.threadId) {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      className="relative flex h-full min-h-0 min-w-0 flex-none border-l border-[var(--app-surface-divider)] bg-[var(--app-content-surface,var(--card))] text-foreground"
      style={
        {
          width: `${panelWidth}px`,
          maxWidth: `calc(100% - ${SPLIT_PANE_CHAT_MIN_WIDTH}px)`,
          minWidth: SINGLE_PANEL_MIN_WIDTH,
        } as CSSProperties
      }
    >
      <PanelWidthResizeHandle onPointerDown={startResize} />
      {props.explorerOpen ? (
        <DockExplorerPane
          threadId={props.threadId}
          workspaceRoot={props.workspaceRoot}
          isVisible={props.isFocused}
        />
      ) : (
        <SplitSourceControl
          threadId={props.threadId}
          turnId={props.panelState.diffTurnId}
          filePath={props.panelState.diffFilePath}
          onCurrentChanges={() =>
            props.onUpdatePanelState({ diffTurnId: null, diffFilePath: null })
          }
        />
      )}
    </div>
  );
}
