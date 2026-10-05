import type { IconComponent } from "~/lib/iconComponent";
import type { ReactNode } from "react";
import {
  FolderLibraryIcon,
  GitCommitHorizontalIcon,
  InfoIcon,
  Globe02Icon,
  ComputerTerminal01Icon,
} from "~/lib/icons";
import { type RightDockPane, type RightDockPaneKind } from "~/rightDockStore.logic";
import { SurfaceChipIcon } from "./chatHeaderControls";
export interface RightDockPaneMeta {
  label: string;
  Icon: IconComponent;
}
const RIGHT_DOCK_PANE_META: Record<RightDockPaneKind, RightDockPaneMeta> = {
  browser: {
    label: "Browser",
    Icon: Globe02Icon,
  },
  explorer: {
    label: "Explorer",
    Icon: FolderLibraryIcon,
  },
  terminal: {
    label: "Terminal",
    Icon: ComputerTerminal01Icon,
  },
  git: {
    label: "Source Control",
    Icon: GitCommitHorizontalIcon,
  },
};
const FALLBACK_RIGHT_DOCK_PANE_META: RightDockPaneMeta = {
  label: "Panel",
  Icon: InfoIcon,
};
export function getRightDockPaneMeta(kind: RightDockPaneKind): RightDockPaneMeta {
  return RIGHT_DOCK_PANE_META[kind] ?? FALLBACK_RIGHT_DOCK_PANE_META;
}
export function resolveRightDockPaneLabel(
  pane: RightDockPane,
  overrides?: Record<string, string | undefined>,
): string {
  return overrides?.[pane.id] ?? getRightDockPaneMeta(pane.kind).label;
}
export function resolveRightDockPaneIcon(pane: RightDockPane): ReactNode {
  return <SurfaceChipIcon icon={getRightDockPaneMeta(pane.kind).Icon} />;
}
