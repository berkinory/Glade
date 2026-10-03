import type { ProjectFileSystemEntry } from "@glade/contracts/workspace/project";
import { useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { useAppSettings } from "~/appSettings";
import { projectListDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { ExplorerRow } from "./ExplorerFileRow";
import { ExplorerInlineName } from "./ExplorerInlineName";
import { ExplorerLoadingRows } from "./ExplorerLoadingRows";
import type { WorkspaceExplorerActions } from "./useWorkspaceExplorerActions";

type TreeRow =
  | { key: string; depth: number; kind: "entry"; entry: ProjectFileSystemEntry }
  | { key: string; depth: number; kind: "edit" }
  | { key: string; depth: number; kind: "loading" }
  | { key: string; depth: number; kind: "error"; message: string };

function isVisibleDirectory(path: string, expanded: ReadonlySet<string>): boolean {
  let parent = path.lastIndexOf("/");
  while (parent >= 0) {
    if (!expanded.has(path.slice(0, parent))) return false;
    parent = path.lastIndexOf("/", parent - 1);
  }
  return true;
}

export function WorkspaceExplorerTree(props: {
  workspaceRoot: string;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  dirtyPaths: ReadonlySet<string>;
  onSelectFile: (path: string, options?: { preview?: boolean }) => void;
  onToggleDirectory: (path: string) => void;
  onPrefetchEntry: (entry: ProjectFileSystemEntry) => void;
  actions: WorkspaceExplorerActions;
  onEntryContextMenu: (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => void;
}) {
  const { settings } = useAppSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const directories = [
    "",
    ...[...props.expandedDirectories].filter((path) =>
      isVisibleDirectory(path, props.expandedDirectories),
    ),
  ];
  const queries = useQueries({
    queries: directories.map((relativePath) =>
      projectListDirectoriesQueryOptions({
        cwd: props.workspaceRoot,
        relativePath,
        includeFiles: true,
      }),
    ),
  });
  const queriesByPath = new Map(directories.map((path, index) => [path, queries[index]]));
  const rows: TreeRow[] = [];
  const edit = props.actions.edit;
  const appendDirectory = (path: string, depth: number) => {
    const query = queriesByPath.get(path);
    if (!query || (query.isLoading && !query.data)) {
      rows.push({ key: `loading:${path}`, kind: "loading", depth });
      return;
    }
    if (query.error) {
      rows.push({ key: `error:${path}`, kind: "error", depth, message: query.error.message });
      return;
    }
    if (edit?.action === "create" && edit.parent === path) {
      rows.push({ key: `create:${path}:${edit.kind}`, kind: "edit", depth });
    }
    for (const entry of query.data?.entries ?? []) {
      if (settings.hideIgnoredFiles && entry.isGitIgnored) continue;
      if (edit?.action === "rename" && edit.entry?.path === entry.path) {
        rows.push({ key: `rename:${entry.path}`, kind: "edit", depth });
        continue;
      }
      rows.push({ key: entry.path, kind: "entry", entry, depth });
      if (entry.kind === "directory" && props.expandedDirectories.has(entry.path)) {
        appendDirectory(entry.path, depth + 1);
      }
    }
  };
  appendDirectory("", 0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]!.key,
    estimateSize: (index) => (rows[index]?.kind === "loading" ? 84 : 28),
    overscan: 8,
  });
  const selectedIndex = rows.findIndex(
    (row) => row.kind === "entry" && row.entry.path === props.selectedFilePath,
  );
  const editIndex = rows.findIndex((row) => row.kind === "edit");
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, props.selectedFilePath, props.workspaceRoot, virtualizer]);
  useEffect(() => {
    if (editIndex >= 0) virtualizer.scrollToIndex(editIndex, { align: "auto" });
  }, [editIndex, edit, virtualizer]);

  return (
    <div
      ref={scrollRef}
      data-explorer-tree
      tabIndex={0}
      className="min-h-0 flex-1 overflow-auto px-1 py-1"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.actions.setSelectedDirectory("");
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const { key } = event;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
        if (
          (event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement) &&
          key !== "ArrowDown"
        )
          return;
        const navigable = rows.flatMap((row, index) => (row.kind === "entry" ? [index] : []));
        if (navigable.length === 0) return;
        const currentRow =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-tree-index]")
            : null;
        const current = navigable.indexOf(Number(currentRow?.dataset.treeIndex ?? -1));
        const next =
          key === "Home"
            ? 0
            : key === "End"
              ? navigable.length - 1
              : key === "ArrowDown"
                ? Math.min(current + 1, navigable.length - 1)
                : current < 0
                  ? navigable.length - 1
                  : Math.max(0, current - 1);
        const index = navigable[next]!;
        event.preventDefault();
        pendingFocus.current = index;
        virtualizer.scrollToIndex(index, { align: "auto" });
        const button = scrollRef.current?.querySelector<HTMLButtonElement>(
          `[data-tree-index="${index}"] button`,
        );
        if (button) {
          pendingFocus.current = null;
          button.focus({ preventScroll: true });
        }
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          const expanded = row.kind === "entry" && props.expandedDirectories.has(row.entry.path);
          return (
            <div
              key={item.key}
              data-tree-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
              ref={(node) => {
                if (node && pendingFocus.current === item.index) {
                  pendingFocus.current = null;
                  node.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
                }
              }}
            >
              {row.kind === "loading" ? (
                <ExplorerLoadingRows depth={row.depth} />
              ) : row.kind === "error" ? (
                <p className="px-3 text-ui-sm text-destructive/80">{row.message}</p>
              ) : row.kind === "edit" && edit ? (
                <ExplorerInlineName
                  kind={edit.kind}
                  path={edit.entry?.path ?? `${edit.parent}/new`}
                  depth={row.depth}
                  initialName={edit.entry?.name ?? ""}
                  creating={edit.action === "create"}
                  onSubmit={props.actions.submitEdit}
                  onCancel={props.actions.cancelEdit}
                />
              ) : row.kind === "entry" ? (
                <ExplorerRow
                  entry={row.entry}
                  depth={row.depth}
                  expanded={expanded}
                  selected={
                    row.entry.kind === "directory"
                      ? props.actions.selectedDirectory === row.entry.path
                      : row.entry.path === props.selectedFilePath
                  }
                  dirty={
                    props.dirtyPaths.has(row.entry.path) ||
                    (row.entry.kind === "directory" &&
                      !expanded &&
                      [...props.dirtyPaths].some((path) => path.startsWith(`${row.entry.path}/`)))
                  }
                  onSelectFile={props.onSelectFile}
                  onPrefetchEntry={props.onPrefetchEntry}
                  onSelectDirectory={(path) => {
                    props.actions.setSelectedDirectory(path);
                    if (row.entry.kind === "directory") props.onToggleDirectory(path);
                  }}
                  aria-expanded={row.entry.kind === "directory" ? expanded : undefined}
                  onEntryContextMenu={props.onEntryContextMenu}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
