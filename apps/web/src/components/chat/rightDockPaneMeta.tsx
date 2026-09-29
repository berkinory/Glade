import type { ReactNode } from "react";

import { basenameOfPath } from "~/file-icons";
import type { LucideIcon } from "~/lib/icons";
import {
  DeviceMobileIcon,
  FileIcon,
  FoldersIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InfoIcon,
  TerminalIcon,
} from "~/lib/icons";
import { type RightDockPane, type RightDockPaneKind } from "~/rightDockStore.logic";
import { CHAT_SURFACE_CHIP_ICON_CLASS_NAME, SurfaceChipIcon } from "./chatHeaderControls";
import { FileEntryIcon } from "./FileEntryIcon";
import { pullRequestPaneTabLabel } from "../pullRequest/pullRequestDetail.logic";

export interface RightDockPaneMeta {
  label: string;
  Icon: LucideIcon;
}

const RIGHT_DOCK_PANE_META: Record<RightDockPaneKind, RightDockPaneMeta> = {
  browser: { label: "Browser", Icon: GlobeIcon },

  device: { label: "Simulator", Icon: DeviceMobileIcon },
  explorer: { label: "Explorer", Icon: FoldersIcon },
  file: { label: "File", Icon: FileIcon },
  terminal: { label: "Terminal", Icon: TerminalIcon },
  git: { label: "Source Control", Icon: GitCommitIcon },
  pullRequest: { label: "Pull request", Icon: GitPullRequestIcon },
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

export function buildRightDockPaneLabelOverrides(
  panes: readonly RightDockPane[],
): Record<string, string | undefined> | undefined {
  const overrides: Record<string, string | undefined> = {};

  for (const pane of panes) {
    if (pane.kind === "file" && pane.filePath) {
      overrides[pane.id] = basenameOfPath(pane.filePath);
    } else if (pane.kind === "pullRequest" && pane.pullRequestNumber !== null) {
      overrides[pane.id] = pullRequestPaneTabLabel(pane.pullRequestNumber);
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function resolveRightDockPaneIcon(pane: RightDockPane): ReactNode {
  if (pane.kind === "file" && pane.filePath) {
    return (
      <FileEntryIcon
        pathValue={pane.filePath}
        kind="file"
        className={CHAT_SURFACE_CHIP_ICON_CLASS_NAME}
      />
    );
  }
  return <SurfaceChipIcon icon={getRightDockPaneMeta(pane.kind).Icon} />;
}
