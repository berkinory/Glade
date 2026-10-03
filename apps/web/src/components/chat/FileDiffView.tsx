import { useAppSettings } from "~/appSettings";
import {
  FileDiff,
  type FileDiffMetadata,
  type FileDiffProps,
  Virtualizer,
} from "@pierre/diffs/react";
import { type ReactNode } from "react";

import { buildDiffPanelUnsafeCSS, resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { useActivateDiffWorkers } from "../DiffWorkerPoolProvider";
import { FileDiffHeader } from "./FileDiffHeader";

const DIFF_VIRTUALIZER_CONFIG = {
  overscrollSize: 400,
  intersectionObserverMargin: 600,
};

// Virtualized scroll container shared by single-file (GitPanel) and multi-file (DiffPanel) diff
// lists. Callers own the inner per-file wrapper markup because it differs (collapse click capture,
// data-diff-file-path scroll anchors, etc.).
export function FileDiffSurface(props: { className?: string; children: ReactNode }) {
  useActivateDiffWorkers();
  return (
    <Virtualizer
      className={cn("diff-render-surface", props.className)}
      config={DIFF_VIRTUALIZER_CONFIG}
    >
      {props.children}
    </Virtualizer>
  );
}

type FileDiffCardOptions = NonNullable<FileDiffProps<unknown>["options"]>;

export type DiffLineClickProps = Parameters<NonNullable<FileDiffCardOptions["onLineClick"]>>[0];

export function FileDiffCard(props: {
  fileDiff: FileDiffMetadata;
  theme: "light" | "dark";
  diffStyle?: "unified" | "split";
  overflow?: "scroll" | "wrap";
  collapsed?: boolean;
  hideHeader?: boolean;

  renderHeaderTrailing?: () => ReactNode;
  onLineClick?: ((line: DiffLineClickProps) => void) | undefined;
}) {
  const { settings } = useAppSettings();
  return (
    <FileDiff
      fileDiff={props.fileDiff}
      options={{
        disableFileHeader: props.hideHeader ?? false,
        diffStyle: props.diffStyle ?? "unified",
        lineDiffType: "word",
        overflow: props.overflow ?? (settings.diffWordWrap ? "wrap" : "scroll"),
        theme: resolveDiffThemeName(props.theme),
        themeType: props.theme,
        unsafeCSS: buildDiffPanelUnsafeCSS(props.theme),
        ...(props.collapsed !== undefined ? { collapsed: props.collapsed } : {}),
        ...(props.onLineClick ? { onLineClick: props.onLineClick } : {}),
      }}
      renderCustomHeader={(fileDiff) => (
        <FileDiffHeader
          fileDiff={fileDiff}
          theme={props.theme}
          trailing={props.renderHeaderTrailing?.()}
        />
      )}
    />
  );
}
