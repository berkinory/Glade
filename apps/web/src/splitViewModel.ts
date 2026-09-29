import type { ProjectId, ThreadId, TurnId } from "@glade/contracts";
import type { ChatRightPanel } from "./diffRouteSearch";

export type SplitViewId = string;
export type PaneId = string;
export type SplitDirection = "horizontal" | "vertical";
// "first" maps to the top/left side of a split; "second" maps to the bottom/right side.
export type SplitDropSide = "first" | "second";

export interface SplitViewPanePanelState {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
  lastOpenPanel: ChatRightPanel;
}

export interface LeafPane {
  kind: "leaf";
  id: PaneId;
  threadId: ThreadId | null;
  panel: SplitViewPanePanelState;
}

export interface SplitNode {
  kind: "split";
  id: PaneId;
  direction: SplitDirection;
  // first = left (horizontal) | top (vertical); second = right | bottom.
  first: Pane;
  second: Pane;
  ratio: number;
}

export type Pane = LeafPane | SplitNode;

export interface SplitView {
  id: SplitViewId;
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
  root: Pane;
  focusedPaneId: PaneId;
  createdAt: string;
  updatedAt: string;
}
