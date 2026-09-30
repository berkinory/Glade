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
import { formatFileCommentRange, type FileCommentSelection } from "~/lib/fileComments";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import { gitWorkingTreeDiffQueryOptions } from "../lib/gitQueryOptions";
import { PlusIcon } from "~/lib/icons";
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
import { FileLineCommentBox } from "./chat/FileLineCommentBox";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import { useFileLineCommenting } from "./chat/useFileLineCommenting";
import { WorkspaceFilePreviewHeader } from "./chat/WorkspaceFilePreviewHeader";
import { TranscriptSelectionAction } from "./chat/TranscriptSelectionAction";
import { useCodeSelectionAction } from "./chat/useCodeSelectionAction";
import { LocalImagePreview } from "./LocalImagePreview";
import { PdfFilePreview } from "./PdfFilePreview";

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
  revealPosition?: { lineNumber: number; requestId: number } | undefined;
  workspaceRoot: string | null;

  filePath: string | null;

  markdownPreviewDefault?: boolean;

  markdownPreviewEnabled?: boolean;
  onMarkdownPreviewChange?: (rendered: boolean) => void;

  editable?: boolean;

  liveRevalidationEnabled?: boolean;

  emptyState?: ReactNode;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat?: ((comment: FileCommentSelection) => void) | undefined;
}

export function WorkspaceFilePreview(props: WorkspaceFilePreviewProps) {
  const liveRevalidationEnabled = props.liveRevalidationEnabled ?? true;
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const contentsRef = useRef<HTMLDivElement>(null);
  const taskWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestTaskWriteVersionRef = useRef({ next: 0, byFile: new Map<string, number>() });
  const taskFileDiskVersionRef = useRef(new Map<string, string>());
  const {
    filePath: requestedFilePath,
    onAskWhyInChat,
    onCommentInChat,
    onReferenceInChat,
    workspaceRoot,
  } = props;
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
  const filePath = relocatedFullPath ?? requestedFilePath;
  const markdownPreviewDefault = props.markdownPreviewDefault ?? false;
  const fileIsImage = filePath !== null && isSupportedLocalImagePath(filePath);
  const fileIsPdf = filePath !== null && isSupportedLocalPdfPath(filePath);
  const fileIsLocalAbsolute = filePath !== null && isLocalAbsolutePath(filePath);
  const fileIsWorkspaceRelative = filePath !== null && isWorkspaceRelativePathSafe(filePath);
  const fileIsScratchBinaryPreview =
    filePath !== null && (fileIsImage || fileIsPdf) && isScratchWorkspacePath(filePath);
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
  const binaryPreviewKey = `${props.workspaceRoot ?? ""}\0${filePath ?? ""}\0${localPreviewGrant ?? ""}\0${binaryPreviewRevision}`;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.workspaceRoot,
      relativePath: filePath,
      previewGrant: localPreviewGrant,

      enabled:
        liveRevalidationEnabled &&
        filePath !== null &&
        !fileIsImage &&
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
    ((fileIsImage || fileIsPdf) &&
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
      if (fileIsImage || fileIsPdf) {
        setBinaryPreviewReloading(true);
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
  const handleEditBufferChange = editor.handleChange;
  const handleEditBufferSave = editor.save;

  const handleFileReload = useCallback(() => {
    if (!filePath) return;
    if (fileIsImage || fileIsPdf) {
      setBinaryPreviewReloading(true);
      setBinaryPreviewRevision((current) => current + 1);
      return;
    }
    void refetchFreshProjectFileQuery(queryClient, {
      cwd: workspaceRoot,
      relativePath: filePath,
    });
  }, [fileIsImage, fileIsPdf, filePath, queryClient, workspaceRoot]);

  const handleEditBufferReload = editor.reloadFromDisk;

  const changeGutterEnabled =
    props.workspaceRoot !== null &&
    resolvedWorkspaceRelativePath !== null &&
    fileQuery.data !== undefined &&
    !fileIsImage &&
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
  const commitPreviewSelection = (selection: Omit<ChatFileReference, "path">) => {
    if (filePath) {
      onReferenceInChat?.({ path: filePath, ...selection });
    }
  };
  const previewSelectionAction = useCodeSelectionAction({
    enabled: Boolean(onReferenceInChat && filePath) && (showMarkdownPreview || !editableDocument),
    readSelection: readPreviewSelection,
    onCommit: commitPreviewSelection,
  });

  const lineCommentingEnabled =
    Boolean(onCommentInChat && filePath) && !showMarkdownPreview && !editableDocument;
  const lineCommenting = useFileLineCommenting({
    enabled: lineCommentingEnabled,
    resetKey: filePath,
  });
  const commitLineComment = (
    selection: Pick<FileCommentSelection, "startLine" | "endLine" | "text">,
  ) => {
    if (filePath) {
      onCommentInChat?.({ path: filePath, ...selection });
    }
  };
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
      selection,
      onReferenceInChat,
      onAskWhyInChat,
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
    setMarkdownPreviewOverride({ filePath, rendered });
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
  if (!props.workspaceRoot && !fileIsLocalAbsolute && !fileIsScratchBinaryPreview) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p>No workspace is attached to this chat.</p>
      </PanelStateMessage>
    );
  }

  if (!filePath) {
    return (
      props.emptyState ?? (
        <PanelStateMessage density="compact" fill="flex">
          <p>Select a file from the explorer.</p>
        </PanelStateMessage>
      )
    );
  }
  if (fileNeedsLocalPreviewGrant && !localPreviewGrant) {
    if (localPreviewGrantQuery.error) {
      return (
        <PanelStateMessage density="compact" fill="flex" className="items-start justify-start p-3">
          <p className="text-left text-ui-sm text-destructive/85">
            {localPreviewGrantQuery.error instanceof Error
              ? localPreviewGrantQuery.error.message
              : "Could not create local file preview grant."}
          </p>
        </PanelStateMessage>
      );
    }
    return <FilePreviewLoadingState />;
  }

  if (fileIsPdf && locatingOutOfRootFile) {
    return <FilePreviewLoadingState />;
  }

  if (fileIsPdf) {
    const openInTarget =
      props.workspaceRoot && isWorkspaceRelativePathSafe(filePath)
        ? joinWorkspaceRelativePath(props.workspaceRoot, filePath)
        : filePath;
    return (
      <PdfFilePreview
        key={binaryPreviewKey}
        filePath={filePath}
        cwd={props.workspaceRoot}
        previewGrant={localPreviewGrant}
        cacheKey={binaryPreviewRevision}
        onReload={handleFileReload}
        openInTarget={openInTarget}
        onPreviewReady={handleBinaryPreviewReady}
        onPreviewError={handleBinaryPreviewError}
      />
    );
  }

  const hoveredCommentLine = lineCommenting.hoveredLine;
  const activeCommentLine = lineCommenting.activeLine;
  const hasFileContents = fileQuery.data !== undefined;
  const fileReadError = fileQuery.error;
  const fileReadCapacityError = isRpcCapacityExceededError(fileReadError);
  const showFileReadErrorIndicator =
    hasFileContents && fileReadError !== null && !activeEditBuffer?.error;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]">
      <WorkspaceFilePreviewHeader
        workspaceRoot={props.workspaceRoot}
        filePath={filePath}
        isMarkdown={fileIsMarkdown}
        markdownPreviewEnabled={showMarkdownPreview}
        onMarkdownPreviewChange={handleMarkdownPreviewChange}
        onReferenceInChat={onReferenceInChat}
        contentsForCopy={fileIsImage || fileQuery.data === undefined ? null : displayedFileContents}
        truncated={fileQuery.data?.truncated ?? false}
        dirty={editBufferDirty}
        readOnlyReason={readOnlyReason}
        reloading={fileIsImage || fileIsPdf ? binaryPreviewReloading : fileQuery.isFetching}
        onReload={workspaceRoot && filePath ? handleFileReload : undefined}
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
              onMouseUp={previewSelectionAction.onContainerMouseUp}
              onMouseMove={lineCommenting.onContainerMouseMove}
              onMouseLeave={lineCommenting.onContainerMouseLeave}
            >
              {showMarkdownPreview ? (
                <div className="editor-markdown-preview">
                  <ChatMarkdown
                    text={displayedFileContents}
                    cwd={markdownPreviewCwd(props.workspaceRoot, filePath)}
                    wikiLinkRoot={props.workspaceRoot ?? undefined}
                    isStreaming={false}
                    className="editor-markdown-preview__body text-sm leading-relaxed"
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
              {previewSelectionAction.pendingAction ? (
                <TranscriptSelectionAction
                  left={previewSelectionAction.pendingAction.left}
                  top={previewSelectionAction.pendingAction.top}
                  placement={previewSelectionAction.pendingAction.placement}
                  onAddToChat={previewSelectionAction.commit}
                />
              ) : null}
              {lineCommentingEnabled && hoveredCommentLine && !activeCommentLine ? (
                <button
                  type="button"
                  className="editor-file-viewer__comment-add"
                  style={{
                    top: hoveredCommentLine.top,
                    left: hoveredCommentLine.left,
                    height: hoveredCommentLine.height,
                  }}
                  aria-label={`Comment on line ${hoveredCommentLine.lineNumber}`}
                  title="Comment"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    lineCommenting.openComment(hoveredCommentLine);
                  }}
                >
                  <span className="editor-file-viewer__comment-add-glyph">
                    <PlusIcon className="size-3.5" />
                  </span>
                </button>
              ) : null}
              {lineCommentingEnabled && activeCommentLine ? (
                <>
                  <div
                    className="editor-file-viewer__comment-line-highlight"
                    style={{ top: activeCommentLine.top, height: activeCommentLine.height }}
                    aria-hidden="true"
                  />
                  <FileLineCommentBox
                    lineLabel={formatFileCommentRange({
                      startLine: activeCommentLine.lineNumber,
                      endLine: activeCommentLine.lineNumber,
                    })}
                    top={activeCommentLine.top + activeCommentLine.height}
                    left={activeCommentLine.left}
                    width={Math.max(
                      240,
                      Math.min(440, activeCommentLine.containerWidth - activeCommentLine.left - 16),
                    )}
                    onCancel={lineCommenting.closeComment}
                    onSubmit={(text) => {
                      commitLineComment({
                        startLine: activeCommentLine.lineNumber,
                        endLine: activeCommentLine.lineNumber,
                        text,
                      });
                      lineCommenting.closeComment();
                    }}
                  />
                </>
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
