import { isSupportedLocalVideoPath } from "@glade/shared/attachments/localVideoFiles";
import type {
  ProjectFileChangeEvent,
  ProjectReadFileResult,
} from "@glade/contracts/workspace/project";
import {
  isSupportedLocalImagePath,
  isSupportedLocalPdfPath,
  lowerCaseExtensionOf,
} from "@glade/shared/browser/localPreviewFiles";
import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@glade/shared/platform/path";
import { isScratchWorkspacePath } from "@glade/shared/threads/threadWorkspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppSettings } from "~/appSettings";
import { basenameOfPath } from "~/file-icons";
import { useWorkspaceFileEditorBuffer } from "~/hooks/useWorkspaceFileEditor";
import { useTheme } from "~/hooks/useTheme";
import { useProjectFileChangeSubscription } from "~/hooks/useProjectFileChangeSubscription";
import {
  getSelectionSnippetWithin,
  getSelectionWithin,
  type ChatFileReference,
} from "~/lib/chatReferences";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { extractEditorGutterChanges } from "~/lib/editorGutterDiff";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import { gitWorkingTreeDiffQueryOptions } from "../lib/gitQueryOptions";
import { isRpcCapacityExceededError } from "~/lib/expensiveReadRetry";
import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
  projectReadFileQueryOptions,
  refetchFreshProjectFileQuery,
  projectResolveOutOfRootFileReferenceQueryOptions,
} from "~/lib/projectReactQuery";
import { refreshGitAfterFileWrite } from "../lib/gitQueryOptions";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import ChatMarkdown from "./ChatMarkdown";
import {
  EditableFileContents,
  FileContentsView,
  FilePreviewChangeGutter,
  FilePreviewLoadingState,
} from "./WorkspaceFileContents";
import { DiffTruncationWarning } from "./DiffTruncationWarning";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import { WorkspaceFilePreviewHeader } from "./chat/WorkspaceFilePreviewHeader";
import { LocalVideoThumbnail } from "./LocalVideoThumbnail";
import { buildLocalImageUrl } from "~/lib/localImageUrls";
import { LocalImagePreview } from "./LocalImagePreview";
import { PdfFilePreview } from "./PdfFilePreview";
import { UnsupportedFilePreview } from "./UnsupportedFilePreview";

const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".markdown", ".md", ".mdx"]);

function isMarkdownPreviewablePath(filePath: string): boolean {
  const extension = lowerCaseExtensionOf(filePath);
  return extension !== null && MARKDOWN_PREVIEW_EXTENSIONS.has(extension);
}

function parentDirectoryFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return null;
  }
  return normalized.slice(0, separatorIndex);
}

function markdownPreviewCwd(workspaceRoot: string | null, filePath: string): string | undefined {
  const parentDirectory = parentDirectoryFromPath(filePath);
  if (isLocalAbsolutePath(filePath)) {
    return parentDirectory ?? undefined;
  }
  if (!workspaceRoot) {
    return undefined;
  }
  if (!parentDirectory) {
    return workspaceRoot;
  }
  return joinWorkspaceRelativePath(workspaceRoot, parentDirectory);
}

export interface WorkspaceFilePreviewProps {
  headerLeading?: ReactNode;
  revealPosition?: { lineNumber: number; column?: number; requestId: number } | undefined;
  workspaceRoot: string | null;

  filePath: string | null;

  markdownPreviewDefault?: boolean;

  markdownPreviewEnabled?: boolean;
  onMarkdownPreviewChange?: (rendered: boolean) => void;

  editable?: boolean;
  onEdit?: () => void;

  liveRevalidationEnabled?: boolean;

  emptyState?: ReactNode;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
}

export function WorkspaceFilePreview(props: WorkspaceFilePreviewProps) {
  const liveRevalidationEnabled = props.liveRevalidationEnabled ?? true;
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const contentsRef = useRef<HTMLDivElement>(null);
  const taskWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestTaskWriteVersionRef = useRef({ next: 0, byFile: new Map<string, number>() });
  const taskFileDiskVersionRef = useRef(new Map<string, string>());
  const { filePath: requestedFilePath, onReferenceInChat, workspaceRoot } = props;
  const queryClient = useQueryClient();

  const [relocation, setRelocation] = useState<{
    requestedKey: string;
    fullPath: string;
  } | null>(null);
  const relocationRequestKey = `${workspaceRoot ?? ""}\0${requestedFilePath ?? ""}`;
  const relocatedFullPath =
    relocation?.requestedKey === relocationRequestKey ? relocation.fullPath : null;
  const [binaryPreviewErrorKey, setBinaryPreviewErrorKey] = useState<string | null>(null);
  const [binaryPreviewRevision, setBinaryPreviewRevision] = useState(0);
  const [binaryPreviewReloading, setBinaryPreviewReloading] = useState(false);
  const [manualFileReload, setManualFileReload] = useState<{ key: string } | null>(null);
  const filePath = relocatedFullPath ?? requestedFilePath;
  const { settings, updateSettings } = useAppSettings();
  const markdownPreviewDefault = props.markdownPreviewDefault ?? settings.markdownPreviewEnabled;
  const fileIsImage = filePath !== null && isSupportedLocalImagePath(filePath);
  const fileIsVideo = filePath !== null && isSupportedLocalVideoPath(filePath);
  const fileIsPdf = filePath !== null && isSupportedLocalPdfPath(filePath);
  const fileIsLocalAbsolute = filePath !== null && isLocalAbsolutePath(filePath);
  const fileIsWorkspaceRelative = filePath !== null && isWorkspaceRelativePathSafe(filePath);
  const fileIsScratchBinaryPreview =
    filePath !== null &&
    (fileIsImage || fileIsPdf || fileIsVideo) &&
    isScratchWorkspacePath(filePath);
  const fileNeedsLocalPreviewGrant =
    filePath !== null && fileIsLocalAbsolute && !fileIsScratchBinaryPreview;
  const fileIsMarkdown = filePath !== null && isMarkdownPreviewablePath(filePath);

  const [markdownPreviewOverride, setMarkdownPreviewOverride] = useState<{
    filePath: string | null;
    rendered: boolean;
  } | null>(null);
  useEffect(() => {
    if (props.revealPosition) setMarkdownPreviewOverride({ filePath, rendered: false });
  }, [props.revealPosition, filePath]);
  const markdownPreviewEnabled =
    props.markdownPreviewEnabled ??
    (markdownPreviewOverride !== null && markdownPreviewOverride.filePath === filePath
      ? markdownPreviewOverride.rendered
      : markdownPreviewDefault);
  const localPreviewGrantQuery = useQuery(
    projectLocalPreviewGrantQueryOptions({
      path: filePath,
      enabled: fileNeedsLocalPreviewGrant,
    }),
  );
  const localPreviewGrant =
    fileNeedsLocalPreviewGrant && isLocalPreviewGrantUsable(localPreviewGrantQuery.data)
      ? (localPreviewGrantQuery.data?.grant ?? null)
      : null;
  const binaryPreviewKey = `${props.workspaceRoot ?? ""}\0${filePath ?? ""}`;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.workspaceRoot,
      relativePath: filePath,
      previewGrant: localPreviewGrant,

      enabled:
        liveRevalidationEnabled &&
        filePath !== null &&
        !fileIsImage &&
        !fileIsVideo &&
        !fileIsPdf &&
        (fileNeedsLocalPreviewGrant ? localPreviewGrant !== null : props.workspaceRoot !== null),
    }),
  );
  const resolvedWorkspaceRelativePath =
    fileQuery.data && isWorkspaceRelativePathSafe(fileQuery.data.relativePath)
      ? fileQuery.data.relativePath
      : null;
  const watchedWorkspaceRelativePath =
    resolvedWorkspaceRelativePath ??
    ((fileIsImage || fileIsPdf || fileIsVideo) &&
    workspaceRoot &&
    requestedFilePath &&
    isWorkspaceRelativePathSafe(requestedFilePath)
      ? requestedFilePath
      : null);
  const handleWatchedFileChange = useCallback(
    (event: ProjectFileChangeEvent) => {
      if (!workspaceRoot || !watchedWorkspaceRelativePath) return;
      void refetchFreshProjectFileQuery(queryClient, {
        cwd: workspaceRoot,
        relativePath: requestedFilePath,
      });

      void refreshGitAfterFileWrite(queryClient, workspaceRoot);
      if (fileIsImage || fileIsPdf || fileIsVideo) {
        setBinaryPreviewRevision((current) => current + 1);
      }
      if (event.type === "changed") {
        setRelocation((current) =>
          current?.requestedKey === relocationRequestKey ? null : current,
        );
        setBinaryPreviewErrorKey((current) => (current === relocationRequestKey ? null : current));
      }
    },
    [
      fileIsImage,
      fileIsVideo,
      fileIsPdf,
      queryClient,
      relocationRequestKey,
      requestedFilePath,
      watchedWorkspaceRelativePath,
      workspaceRoot,
    ],
  );
  useProjectFileChangeSubscription({
    cwd: workspaceRoot,
    relativePath: watchedWorkspaceRelativePath,
    enabled: liveRevalidationEnabled && watchedWorkspaceRelativePath !== null,
    onChange: handleWatchedFileChange,
  });

  const binaryPreviewFailed = binaryPreviewErrorKey === relocationRequestKey;
  const fileReadFailedWithoutContents =
    fileQuery.isError &&
    fileQuery.data === undefined &&
    !isRpcCapacityExceededError(fileQuery.error);
  const outOfRootResolutionEnabled =
    workspaceRoot !== null &&
    requestedFilePath !== null &&
    isWorkspaceRelativePathSafe(requestedFilePath) &&
    (fileReadFailedWithoutContents || binaryPreviewFailed || relocatedFullPath !== null);
  const outOfRootResolutionQuery = useQuery(
    projectResolveOutOfRootFileReferenceQueryOptions({
      cwd: workspaceRoot,
      relativePath: requestedFilePath,
      enabled: outOfRootResolutionEnabled,
    }),
  );
  const resolvedOutOfRootFullPath = outOfRootResolutionQuery.data?.fullPath ?? null;
  const locatingOutOfRootFile =
    outOfRootResolutionEnabled &&
    (outOfRootResolutionQuery.isPending || outOfRootResolutionQuery.isFetching);
  useEffect(() => {
    if (!outOfRootResolutionEnabled || !outOfRootResolutionQuery.isSuccess) {
      return;
    }
    if (resolvedOutOfRootFullPath !== null) {
      setRelocation((current) =>
        current?.requestedKey === relocationRequestKey &&
        current.fullPath === resolvedOutOfRootFullPath
          ? current
          : { requestedKey: relocationRequestKey, fullPath: resolvedOutOfRootFullPath },
      );
      return;
    }
    setRelocation((current) => (current?.requestedKey === relocationRequestKey ? null : current));
    setBinaryPreviewErrorKey((current) => (current === relocationRequestKey ? null : current));
  }, [
    outOfRootResolutionEnabled,
    outOfRootResolutionQuery.isSuccess,
    relocationRequestKey,
    resolvedOutOfRootFullPath,
  ]);
  const handleBinaryPreviewReady = useCallback(() => {
    setBinaryPreviewReloading(false);
    setBinaryPreviewErrorKey((current) => (current === relocationRequestKey ? null : current));
  }, [relocationRequestKey]);
  const handleBinaryPreviewError = useCallback(() => {
    setBinaryPreviewReloading(false);
    setBinaryPreviewErrorKey(relocationRequestKey);
  }, [relocationRequestKey]);

  const fileContents = fileQuery.data?.contents ?? "";
  const showMarkdownPreview = fileIsMarkdown && markdownPreviewEnabled;
  const editor = useWorkspaceFileEditorBuffer({
    cwd: workspaceRoot,
    filePath,
    enabled: Boolean(props.editable && fileIsWorkspaceRelative),
    file: fileQuery.data,
  });
  const editableDocument =
    props.editable &&
    fileIsWorkspaceRelative &&
    workspaceRoot &&
    fileQuery.data &&
    editor.readOnlyReason === null
      ? fileQuery.data
      : null;
  const activeEditBuffer =
    editableDocument && editor.canEdit
      ? {
          key: editor.state.key!,
          contents: editor.state.value,
          saving: editor.state.saving,
          error: editor.state.saveError,
        }
      : null;
  const editBufferDirty = editor.dirty;
  const editBufferExternallyChanged =
    editBufferDirty &&
    editableDocument != null &&
    editor.state.format?.expectedVersion !== editableDocument.version;
  const displayedFileContents = activeEditBuffer?.contents ?? fileContents;
  useEffect(() => {
    if (!props.revealPosition || editableDocument || showMarkdownPreview || !fileQuery.data) return;
    const container = contentsRef.current;
    const pre = container?.querySelector("pre");
    if (!container || !pre) return;
    const line = Math.max(
      0,
      Math.min(props.revealPosition.lineNumber - 1, fileContents.split("\n").length - 1),
    );
    const style = getComputedStyle(pre);
    container.scrollTop = Math.max(
      0,
      line * Number.parseFloat(style.lineHeight) +
        Number.parseFloat(style.paddingTop) -
        container.clientHeight / 2,
    );
  }, [props.revealPosition, editableDocument, showMarkdownPreview, fileQuery.data, fileContents]);
  const lineCount =
    displayedFileContents.length === 0 ? 0 : displayedFileContents.split("\n").length;
  const readOnlyReason =
    !props.editable || showMarkdownPreview || fileQuery.data === undefined
      ? null
      : !fileIsWorkspaceRelative
        ? "Only files inside the project can be edited."
        : editor.readOnlyReason;
  const handleEditBufferChange = (contents: string) => {
    props.onEdit?.();
    editor.handleChange(contents);
  };
  const handleEditBufferSave = editor.save;

  const handleFileReload = useCallback(() => {
    if (!filePath) return;
    if (fileIsImage || fileIsPdf || fileIsVideo) {
      setBinaryPreviewReloading(true);
      setBinaryPreviewRevision((current) => current + 1);
      return;
    }
    const request = { key: binaryPreviewKey };
    setManualFileReload(request);
    void refetchFreshProjectFileQuery(queryClient, {
      cwd: workspaceRoot,
      relativePath: filePath,
    }).finally(() => {
      setManualFileReload((current) => (current === request ? null : current));
    });
  }, [binaryPreviewKey, fileIsImage, fileIsVideo, fileIsPdf, filePath, queryClient, workspaceRoot]);

  const handleEditBufferReload = editor.reloadFromDisk;

  const changeGutterEnabled =
    props.workspaceRoot !== null &&
    resolvedWorkspaceRelativePath !== null &&
    fileQuery.data !== undefined &&
    !fileIsImage &&
    !fileIsVideo &&
    !fileIsPdf &&
    !showMarkdownPreview &&
    editableDocument === null;
  const workingTreeDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      cwd: props.workspaceRoot,
      filePath: resolvedWorkspaceRelativePath,
      enabled: changeGutterEnabled,
    }),
  );
  const workingTreePatch = changeGutterEnabled ? workingTreeDiffQuery.data?.patch : undefined;
  const { ranges: changeRanges, wholeFileAddition: changeGutterSubtle } = useMemo(
    () => extractEditorGutterChanges(workingTreePatch, resolvedWorkspaceRelativePath),
    [workingTreePatch, resolvedWorkspaceRelativePath],
  );

  const readPreviewSelection = (container: HTMLElement): Omit<ChatFileReference, "path"> | null =>
    showMarkdownPreview ? getSelectionSnippetWithin(container) : getSelectionWithin(container);
  // Right-click references the selection (line range in the source view, quoted snippet in the
  // rendered-markdown view), otherwise the whole file.
  const handleContentsContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!filePath) {
      return;
    }
    event.preventDefault();
    const container = contentsRef.current;
    const selection = container ? readPreviewSelection(container) : null;
    void showFileReferenceContextMenu({
      path: filePath,
      position: { x: event.clientX, y: event.clientY },
      selection: props.editable ? null : selection,
      onReferenceInChat,
    });
  };

  const handleTaskToggle = ({ sourceLine, checked }: { sourceLine: number; checked: boolean }) => {
    if (!workspaceRoot || !filePath) {
      return;
    }
    const options = projectReadFileQueryOptions({ cwd: workspaceRoot, relativePath: filePath });
    const current = queryClient.getQueryData(options.queryKey);
    if (
      !current ||
      current.truncated ||
      current.version === null ||
      current.encoding === null ||
      current.lineEnding === null ||
      current.lineEnding === "mixed"
    ) {
      return;
    }
    const nextContents = toggleMarkdownTaskMarker(
      editor.canEdit ? editor.state.value : current.contents,
      sourceLine,
      checked,
    );
    if (nextContents === null) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }
    if (editor.canEdit) {
      editor.handleChange(nextContents);
      editor.save();
      return;
    }
    queryClient.setQueryData(options.queryKey, { ...current, contents: nextContents });

    const writeRelativePath = current.relativePath;
    const writeVersionOnDisk = current.version;
    const writeEncoding = current.encoding;
    const writeLineEnding = current.lineEnding;
    // Writes carry the full file contents, so serialize them: a slower earlier checkbox write must
    // never land after a newer toggle and erase it.
    const fileKey = `${workspaceRoot}\0${filePath}`;
    if (!taskFileDiskVersionRef.current.has(fileKey)) {
      taskFileDiskVersionRef.current.set(fileKey, writeVersionOnDisk);
    }
    const writeVersion = latestTaskWriteVersionRef.current.next + 1;
    latestTaskWriteVersionRef.current.next = writeVersion;
    latestTaskWriteVersionRef.current.byFile.set(fileKey, writeVersion);
    taskWriteQueueRef.current = taskWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await api.projects.writeFile({
          cwd: workspaceRoot,
          relativePath: writeRelativePath,
          contents: nextContents,
          expectedVersion: taskFileDiskVersionRef.current.get(fileKey) ?? writeVersionOnDisk,
          encoding: writeEncoding,
          lineEnding: writeLineEnding,
        });
        taskFileDiskVersionRef.current.set(fileKey, result.version);
        queryClient.setQueryData<ProjectReadFileResult>(options.queryKey, (cached) =>
          cached ? { ...cached, version: result.version } : cached,
        );
      })
      .then(() => undefined)
      .catch(() => {
        if (latestTaskWriteVersionRef.current.byFile.get(fileKey) !== writeVersion) {
          return;
        }
        taskFileDiskVersionRef.current.delete(fileKey);
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      });
    void taskWriteQueueRef.current;
  };
  const handleMarkdownPreviewChange = (rendered: boolean) => {
    setMarkdownPreviewOverride(null);
    updateSettings({ markdownPreviewEnabled: rendered });
    props.onMarkdownPreviewChange?.(rendered);
  };

  const canToggleTasks =
    props.workspaceRoot !== null &&
    fileIsWorkspaceRelative &&
    fileQuery.data !== undefined &&
    !fileQuery.data.truncated &&
    fileQuery.data.version !== null &&
    fileQuery.data.encoding !== null &&
    fileQuery.data.lineEnding !== null &&
    fileQuery.data.lineEnding !== "mixed" &&
    (!editBufferDirty || (editor.canEdit && !editor.state.saveError && !editor.state.conflict));
  const withNavigationHeader = (content: ReactNode) =>
    props.headerLeading ? (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {filePath ? (
          <WorkspaceFilePreviewHeader
            leading={props.headerLeading}
            file={{ path: filePath, workspaceRoot: props.workspaceRoot }}
          />
        ) : (
          <div className="flex h-10 shrink-0 items-center border-b border-border/65 px-3">
            {props.headerLeading}
          </div>
        )}
        {content}
      </div>
    ) : (
      content
    );

  if (!props.workspaceRoot && !fileIsLocalAbsolute && !fileIsScratchBinaryPreview) {
    return withNavigationHeader(
      <PanelStateMessage density="compact" fill="flex">
        <p>No workspace is attached to this chat.</p>
      </PanelStateMessage>,
    );
  }

  if (!filePath) {
    return withNavigationHeader(
      props.emptyState ?? (
        <PanelStateMessage density="compact" fill="flex">
          <p>Select a file from the explorer.</p>
        </PanelStateMessage>
      ),
    );
  }
  if (fileNeedsLocalPreviewGrant && !localPreviewGrant) {
    if (localPreviewGrantQuery.error) {
      return withNavigationHeader(
        <PanelStateMessage density="compact" fill="flex" className="items-start justify-start p-3">
          <p className="text-left text-ui-sm text-destructive/85">
            {localPreviewGrantQuery.error instanceof Error
              ? localPreviewGrantQuery.error.message
              : "Could not create local file preview grant."}
          </p>
        </PanelStateMessage>,
      );
    }
    return withNavigationHeader(<FilePreviewLoadingState />);
  }

  if (fileIsPdf && locatingOutOfRootFile) {
    return withNavigationHeader(<FilePreviewLoadingState />);
  }

  if (fileIsPdf) {
    const openInTarget =
      props.workspaceRoot && isWorkspaceRelativePathSafe(filePath)
        ? joinWorkspaceRelativePath(props.workspaceRoot, filePath)
        : filePath;
    return withNavigationHeader(
      <PdfFilePreview
        key={`${binaryPreviewKey}\0${binaryPreviewRevision}`}
        filePath={filePath}
        cwd={props.workspaceRoot}
        previewGrant={localPreviewGrant}
        cacheKey={binaryPreviewRevision}
        onReload={handleFileReload}
        openInTarget={openInTarget}
        onPreviewReady={handleBinaryPreviewReady}
        onPreviewError={handleBinaryPreviewError}
      />,
    );
  }

  const hasFileContents = fileQuery.data !== undefined;
  const fileReadError = fileQuery.error;
  const fileReadCapacityError = isRpcCapacityExceededError(fileReadError);
  const unsupportedFilePreview =
    fileReadError instanceof Error &&
    /file appears to be binary|file encoding is not supported for text editing/i.test(
      fileReadError.message,
    );
  const showFileReadErrorIndicator =
    hasFileContents && fileReadError !== null && !activeEditBuffer?.error;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--app-content-surface)]">
      <WorkspaceFilePreviewHeader
        leading={props.headerLeading}
        file={{
          path: filePath,
          workspaceRoot: props.workspaceRoot,
          contentsForCopy:
            fileIsImage || fileQuery.data === undefined ? null : displayedFileContents,
          truncated: fileQuery.data?.truncated ?? false,
          dirty: editBufferDirty,
          readOnlyReason,
        }}
        markdownView={
          fileIsMarkdown
            ? { enabled: showMarkdownPreview, onChange: handleMarkdownPreviewChange }
            : undefined
        }
        onReferenceInChat={onReferenceInChat}
        reload={
          workspaceRoot && filePath
            ? {
                onClick: handleFileReload,
                pending:
                  fileIsImage || fileIsPdf || fileIsVideo
                    ? binaryPreviewReloading
                    : manualFileReload?.key === binaryPreviewKey,
              }
            : undefined
        }
      />
      {activeEditBuffer?.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-ui-sm text-destructive"
        >
          <span className="min-w-0 flex-1">{activeEditBuffer.error}</span>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 font-medium text-foreground/80 hover:bg-foreground/8"
            onClick={handleEditBufferReload}
          >
            Reload from disk
          </button>
        </div>
      ) : editBufferExternallyChanged ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-amber-500/25 bg-amber-500/5 px-3 py-2 text-ui-sm text-foreground/80"
        >
          <span className="min-w-0 flex-1">
            This file changed on disk. Your unsaved edits are preserved.
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 font-medium text-foreground/80 hover:bg-foreground/8"
            onClick={handleEditBufferReload}
          >
            Reload from disk
          </button>
        </div>
      ) : showFileReadErrorIndicator ? (
        <div
          role={fileReadCapacityError ? "status" : "alert"}
          className={
            fileReadCapacityError
              ? "flex shrink-0 items-center border-b border-border/60 px-3 py-2 text-ui-sm text-muted-foreground"
              : "flex shrink-0 items-center border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-ui-sm text-destructive"
          }
        >
          {fileReadCapacityError
            ? fileQuery.isFetching
              ? "Refreshing file..."
              : "File refresh delayed."
            : fileReadError instanceof Error
              ? formatWorkspaceFileError(fileReadError)
              : "Could not refresh file."}
        </div>
      ) : null}
      {changeGutterEnabled && workingTreeDiffQuery.data?.truncated === true ? (
        <DiffTruncationWarning className="rounded-none border-x-0 border-t-0">
          Only part of this file&apos;s working-tree diff is available. Change markers may be
          incomplete.
        </DiffTruncationWarning>
      ) : null}
      {locatingOutOfRootFile ? (
        <FilePreviewLoadingState />
      ) : (fileIsImage || fileIsVideo) &&
        fileNeedsLocalPreviewGrant &&
        localPreviewGrantQuery.isPending ? (
        <FilePreviewLoadingState />
      ) : fileIsVideo ? (
        <LocalVideoThumbnail
          key={binaryPreviewKey}
          url={buildLocalImageUrl({
            src: filePath!,
            cwd: props.workspaceRoot ?? undefined,
            grant: localPreviewGrant,
            cacheKey: binaryPreviewRevision,
          })}
          alt={basenameOfPath(filePath!)}
          retainFrameOnReload
          className="min-h-0 flex-1"
          onReady={handleBinaryPreviewReady}
          onError={handleBinaryPreviewError}
        />
      ) : fileIsImage ? (
        <div
          className="editor-file-viewer min-h-0 flex-1 overflow-auto"
          onContextMenu={handleContentsContextMenu}
        >
          <LocalImagePreview
            key={binaryPreviewKey}
            src={filePath}
            cwd={props.workspaceRoot}
            previewGrant={localPreviewGrant}
            cacheKey={binaryPreviewRevision}
            alt={basenameOfPath(filePath)}
            className="min-h-full"
            imageClassName="max-h-[calc(100vh-13rem)]"
            onPreviewReady={handleBinaryPreviewReady}
            onPreviewError={handleBinaryPreviewError}
          />
        </div>
      ) : fileQuery.isLoading ? (
        <FilePreviewLoadingState />
      ) : !hasFileContents && unsupportedFilePreview ? (
        <UnsupportedFilePreview filePath={filePath} workspaceRoot={props.workspaceRoot} />
      ) : !hasFileContents && fileReadError ? (
        <PanelStateMessage density="compact" fill="flex" className="items-start justify-start p-3">
          <p className="text-left text-ui-sm text-destructive/85">
            {formatWorkspaceFileError(fileReadError)}
          </p>
        </PanelStateMessage>
      ) : !hasFileContents ? (
        <FilePreviewLoadingState />
      ) : (
        <>
          {activeEditBuffer && editableDocument ? (
            <EditableFileContents
              revealPosition={props.revealPosition}
              key={activeEditBuffer.key}
              path={filePath}
              contents={activeEditBuffer.contents}
              cacheKey={activeEditBuffer.key}
              hidden={showMarkdownPreview}
              themeName={diffThemeName}
              theme={resolvedTheme}
              saving={activeEditBuffer.saving}
              invalid={activeEditBuffer.error !== null}
              onContentsChange={handleEditBufferChange}
              onSave={() => {
                void handleEditBufferSave();
              }}
            />
          ) : null}
          {!activeEditBuffer || !editableDocument || showMarkdownPreview ? (
            <div
              ref={contentsRef}
              className={cn(
                "editor-file-viewer min-h-0 flex-1 overflow-auto",
                showMarkdownPreview && "editor-file-viewer--markdown-preview",
              )}
              onContextMenu={handleContentsContextMenu}
            >
              {showMarkdownPreview ? (
                <div className="editor-markdown-preview">
                  <ChatMarkdown
                    text={displayedFileContents}
                    cwd={markdownPreviewCwd(props.workspaceRoot, filePath)}
                    wikiLinkRoot={props.workspaceRoot ?? undefined}
                    isStreaming={false}
                    className="editor-markdown-preview__body text-ui leading-relaxed"
                    {...(canToggleTasks ? { onTaskToggle: handleTaskToggle } : {})}
                  />
                </div>
              ) : (
                <FileContentsView
                  path={filePath}
                  contents={fileContents}
                  themeName={diffThemeName}
                />
              )}
              {!showMarkdownPreview && changeRanges.length > 0 ? (
                <FilePreviewChangeGutter ranges={changeRanges} subtle={changeGutterSubtle} />
              ) : null}
              {!showMarkdownPreview && lineCount > 0 ? (
                <span className="sr-only">{lineCount} lines</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function formatWorkspaceFileError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not read file.";
  const detail = error.message.replace(/^workspaceFileSystem\.[\w]+ failed for .*?:\s*/u, "");
  if (/file appears to be binary/i.test(detail))
    return "This is a binary file. Open it in another app to view it.";
  if (/EISDIR|is a directory/i.test(detail))
    return "This is a folder. Select a file to preview it.";
  if (/ENOENT|no such file|not found/i.test(detail))
    return "This file no longer exists. Refresh Explorer to update the list.";
  if (/EACCES|EPERM|permission denied/i.test(detail))
    return "Glade doesn't have permission to read this file.";
  if (/too large|exceeds.*size|size limit/i.test(detail))
    return "This file is too large to preview.";
  return detail || "Could not read file.";
}

const TASK_MARKER_PATTERN = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/;

function toggleMarkdownTaskMarker(
  contents: string,
  sourceLine: number,
  checked: boolean,
): string | null {
  const lines = contents.split("\n");
  const index = sourceLine - 1;
  const line = lines[index];
  if (line === undefined) {
    return null;
  }
  const match = TASK_MARKER_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  lines[index] = `${match[1]}${checked ? "x" : " "}${match[2]}${line.slice(match[0].length)}`;
  return lines.join("\n");
}
