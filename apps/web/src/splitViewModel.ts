import type { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ChatRightPanel } from "./diffRouteSearch";

export type SplitViewId = string;
export type PaneId = string;
export type SplitDirection = "horizontal" | "vertical";

export type SplitDropSide = "first" | "second";

export interface SplitViewPanePanelState {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
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
