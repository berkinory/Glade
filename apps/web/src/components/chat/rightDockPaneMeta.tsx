import type { ReactNode } from "react";

import type { LucideIcon } from "~/lib/icons";
import { FoldersIcon, GitCommitIcon, InfoIcon, GlobeIcon, TerminalIcon } from "~/lib/icons";
import { type RightDockPane, type RightDockPaneKind } from "~/rightDockStore.logic";
import { SurfaceChipIcon } from "./chatHeaderControls";

export interface RightDockPaneMeta {
  label: string;
  Icon: LucideIcon;
}

const RIGHT_DOCK_PANE_META: Record<RightDockPaneKind, RightDockPaneMeta> = {
  browser: { label: "Browser", Icon: GlobeIcon },
  explorer: { label: "Explorer", Icon: FoldersIcon },
  terminal: { label: "Terminal", Icon: TerminalIcon },
  git: { label: "Source Control", Icon: GitCommitIcon },
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
