import {
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { useCopyFileContentsToClipboard, useCopyPathToClipboard } from "~/hooks/useCopyToClipboard";
import type { ChatFileReference } from "~/lib/chatReferences";
import {
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  MessageCircleIcon,
  EllipsisIcon,
  EyeOpenIcon,
  RefreshCwIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME, ChatHeaderIconButton } from "./chatHeaderControls";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { OpenInPicker } from "./OpenInPicker";
import { FileEntryIcon } from "./FileEntryIcon";
import {
  calculateBreadcrumbLayout,
  type CollapsedBreadcrumbLayout,
} from "./workspaceFilePreviewBreadcrumb";

interface WorkspaceFilePreviewHeaderProps {
  workspaceRoot: string | null;
  filePath: string;

  isMarkdown: boolean;

  markdownPreviewEnabled: boolean;
  onMarkdownPreviewChange: (rendered: boolean) => void;

  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;

  contentsForCopy?: string | null;

  truncated?: boolean;

  dirty?: boolean;

  readOnlyReason?: string | null;

  onReload?: (() => void) | undefined;
  reloading?: boolean;
}

const MARKDOWN_VIEW_SEGMENTS = [
  {
    rendered: false,
    label: "Source",
    title: "Source view — select text to reference exact lines in chat",
    Icon: CodeIcon,
  },
  {
    rendered: true,
    label: "Preview",
    title: "Rendered preview — browse and toggle task lists",
    Icon: EyeOpenIcon,
  },
] as const;

interface BreadcrumbSegment {
  name: string;
  key: string;
}

const DIRTY_DOT_RESERVE_PX = 12;
const FILE_ICON_RESERVE_PX = 20;
const MEASURE_EPSILON_PX = 1;

function CollapsingPathBreadcrumb(props: {
  prefixSegments: BreadcrumbSegment[];
  fileSegment: string;
  filePath: string;
  dirty: boolean;
}) {
  const { prefixSegments, fileSegment, filePath, dirty } = props;
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLSpanElement>(null);
  const [collapsedLayout, setCollapsedLayout] = useState<CollapsedBreadcrumbLayout | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    const file = fileRef.current;
    if (!nav || !measure || !file) {
      return;
    }

    const compute = () => {
      const crumbWidths = Array.from(
        measure.querySelectorAll<HTMLElement>('[data-measure="crumb"]'),
        (crumb) => crumb.getBoundingClientRect().width,
      );
      const ellipsisWidth =
        measure.querySelector<HTMLElement>('[data-measure="ellipsis"]')?.getBoundingClientRect()
          .width ?? 0;
      const nextLayout = calculateBreadcrumbLayout({
        containerWidth: nav.clientWidth,
        renderedFileWidth: file.getBoundingClientRect().width,
        prefixWidths: crumbWidths,
        ellipsisWidth,
        trailingReserveWidth:
          FILE_ICON_RESERVE_PX + (dirty ? DIRTY_DOT_RESERVE_PX : 0) + MEASURE_EPSILON_PX,
      });

      setCollapsedLayout((current) => {
        if (current === nextLayout) return current;
        if (current === null || nextLayout === null) return nextLayout;
        return current.visibleTail === nextLayout.visibleTail &&
          current.showEllipsis === nextLayout.showEllipsis
          ? current
          : nextLayout;
      });
    };

    compute();

    const observer = new ResizeObserver(compute);
    observer.observe(nav);
    observer.observe(measure);
    observer.observe(file);
    return () => observer.disconnect();
  }, [filePath, prefixSegments.length, dirty]);

  const visiblePrefix =
    collapsedLayout === null
      ? prefixSegments
      : prefixSegments.slice(prefixSegments.length - collapsedLayout.visibleTail);
  const showEllipsisCrumb =
    collapsedLayout !== null &&
    collapsedLayout.showEllipsis &&
    visiblePrefix.length < prefixSegments.length;

  const crumbChevron = (
    <ChevronRightIcon
      aria-hidden="true"
      className="mx-0.5 size-3 shrink-0 text-muted-foreground/40"
    />
  );

  return (
    <nav
      ref={navRef}
      aria-label="File path"
      className="relative flex min-w-0 flex-1 items-center overflow-hidden text-ui leading-snug"
    >
      {}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center whitespace-nowrap"
      >
        <span data-measure="ellipsis" className="flex items-center">
          <span>…</span>
          {crumbChevron}
        </span>
        {prefixSegments.map((segment) => (
          <span key={segment.key} data-measure="crumb" className="flex items-center">
            <span>{segment.name}</span>
            {crumbChevron}
          </span>
        ))}
      </div>

      {showEllipsisCrumb ? (
        <span className="flex shrink-0 items-center" title={filePath}>
          <span className="text-muted-foreground/80">…</span>
          {crumbChevron}
        </span>
      ) : null}
      {visiblePrefix.map((segment) => (
        <Fragment key={segment.key}>
          <span className="shrink-0 whitespace-nowrap text-muted-foreground/80">
            {segment.name}
          </span>
          {crumbChevron}
        </Fragment>
      ))}
      <FileEntryIcon pathValue={filePath} kind="file" className="mr-1 size-3.5" />
      <span
        ref={fileRef}
        className="min-w-0 shrink truncate font-medium text-foreground"
        title={filePath}
      >
        {fileSegment}
      </span>
      {dirty ? (
        <span
          className="ml-1.5 size-1.5 shrink-0 rounded-full bg-foreground/75"
          role="status"
          aria-label="Unsaved changes"
          title="Unsaved changes"
        />
      ) : null}
    </nav>
  );
}

export const WorkspaceFilePreviewHeader = function WorkspaceFilePreviewHeader(
  props: WorkspaceFilePreviewHeaderProps,
) {
  const { filePath, workspaceRoot } = props;

  const fileIsOutsideWorkspace = !isWorkspaceRelativePathSafe(filePath);

  const relativeSegments = filePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  const segments = relativeSegments;

  const prefixSegments = segments.slice(0, -1).map((name, index) => ({
    name,
    key: segments.slice(0, index + 1).join("/"),
  }));
  const fileSegment = segments.at(-1) ?? filePath;

  const { onReferenceInChat, contentsForCopy } = props;
  const referenceWholeFile = () => {
    onReferenceInChat?.({ path: filePath });
  };
  const copyFileContents = useCopyFileContentsToClipboard();
  const copyPathToClipboard = useCopyPathToClipboard();

  const canCopyContents = contentsForCopy != null;
  const openInTarget =
    fileIsOutsideWorkspace || !workspaceRoot
      ? filePath
      : joinWorkspaceRelativePath(workspaceRoot, filePath);

  return (
    <div
      className={cn(
        "@container/header-actions flex h-10 w-full shrink-0 items-center gap-2 px-3",
        CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
      )}
    >
      <CollapsingPathBreadcrumb
        prefixSegments={prefixSegments}
        fileSegment={fileSegment}
        filePath={filePath}
        dirty={props.dirty ?? false}
      />

      {props.truncated ? (
        <span className="hidden shrink-0 text-ui-xs text-muted-foreground/70 @sm/header-actions:inline">
          Shown partially
        </span>
      ) : props.readOnlyReason ? (
        <span
          className="hidden max-w-32 shrink-0 truncate text-ui-xs text-muted-foreground/70 @sm/header-actions:inline"
          title={props.readOnlyReason}
        >
          Read-only
        </span>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5">
        {props.isMarkdown ? (
          <div
            role="radiogroup"
            aria-label="Markdown view"
            className="flex h-7 shrink-0 items-center rounded-lg bg-[var(--color-background-elevated-secondary)] p-0.5"
          >
            {MARKDOWN_VIEW_SEGMENTS.map((segment) => {
              const selected = segment.rendered === props.markdownPreviewEnabled;
              return (
                <button
                  key={segment.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={segment.title}
                  className={cn(
                    "flex h-6 w-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                    selected
                      ? "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => props.onMarkdownPreviewChange(segment.rendered)}
                >
                  <segment.Icon className="size-3.5 shrink-0" />
                  <span className="sr-only">{segment.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {props.onReload ? (
          <ChatHeaderIconButton
            label="Reload file from disk"
            title="Reload file from disk"
            tone="plain"
            onClick={props.onReload}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={cn("size-3.5", props.reloading && "animate-spin")}
            />
          </ChatHeaderIconButton>
        ) : null}

        <Menu>
          <MenuTrigger render={<ChatHeaderIconButton label="More actions" tone="plain" />}>
            <EllipsisIcon aria-hidden="true" className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="end" side="bottom" className="w-52 min-w-52">
            <MenuItem onClick={() => copyPathToClipboard(openInTarget)}>
              <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Copy path</span>
            </MenuItem>
            {canCopyContents ? (
              <MenuItem
                onClick={() =>
                  copyFileContents(contentsForCopy ?? "", fileSegment, {
                    partial: props.truncated ?? false,
                  })
                }
              >
                <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                Copy contents
              </MenuItem>
            ) : null}
            {onReferenceInChat ? (
              <MenuItem onClick={referenceWholeFile}>
                <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                Reference in chat
              </MenuItem>
            ) : null}
          </ComposerPickerMenuPopup>
        </Menu>

        {}
        <OpenInPicker openInTarget={openInTarget} />
      </div>
    </div>
  );
};
