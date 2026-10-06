import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { lazy, Suspense } from "react";
import type { WorkspaceReviewTab } from "~/mainWorkspaceStore";
import type { ChatFileReference } from "~/lib/chatReferences";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import { LazyBrowserPanel } from "./ChatThreadSurfacePrimitives";
import { WorkspaceGitDiff } from "./WorkspaceGitDiff";
import { CommitDetail } from "./CommitDetail";
import { SourceControlTurnChanges } from "./SourceControlTurnChanges";
import { PanelStateMessage } from "./PanelStateMessage";

const DockTerminalPane = lazy(() => import("./DockTerminalPane"));

export function WorkspaceResource(props: {
  id: string;
  review?: WorkspaceReviewTab | undefined;
  workspace: {
    threadId: ThreadId;
    projectId: ProjectId | null;
    root: string | null;
    terminalFocusRequestId: number;
    revealPosition?:
      | { filePath: string; lineNumber: number; column?: number; requestId: number }
      | undefined;
  };
  visible: boolean;
  focused: boolean;
  onOpenFile: (path: string, edit?: boolean) => void;
  onReferenceInChat: (reference: ChatFileReference) => void;
  actions: { close: () => void; currentChanges: () => void };
}) {
  const { threadId, projectId, root, revealPosition } = props.workspace;
  if (props.id.startsWith("file:")) {
    const filePath = props.id.slice(5);
    return (
      <WorkspaceFilePreview
        workspaceRoot={root}
        filePath={filePath}
        editable
        onEdit={() => props.onOpenFile(filePath, true)}
        liveRevalidationEnabled
        revealPosition={revealPosition?.filePath === filePath ? revealPosition : undefined}
        onReferenceInChat={props.onReferenceInChat}
      />
    );
  }
  const review = props.review;
  if (review && review.kind !== "diff" && !root)
    return <PanelStateMessage>Workspace is unavailable for this review.</PanelStateMessage>;
  if (review?.kind === "commit" && root)
    return (
      <CommitDetail
        cwd={root}
        filePath={review.filePath}
        commit={review}
        onClose={props.actions.close}
        onOpenFile={props.onOpenFile}
      />
    );
  if (review?.kind === "gitFile" && root)
    return (
      <WorkspaceGitDiff
        cwd={root}
        filePath={review.filePath}
        scope={review.scope}
        onOpenFile={props.onOpenFile}
      />
    );
  if (review?.kind === "diff")
    return (
      <SourceControlTurnChanges
        threadId={threadId}
        turnId={review.turnId}
        filePath={review.filePath}
        cwd={root}
        onOpenFile={props.onOpenFile}
        onCurrentChanges={props.actions.currentChanges}
      />
    );
  if (props.id.startsWith("terminal:"))
    return (
      <Suspense fallback={<PanelStateMessage loadingLabel="Loading terminal" />}>
        <DockTerminalPane
          terminalId={props.id.slice(9)}
          hostThreadId={threadId}
          projectId={projectId}
          workspaceRoot={root}
          isActive={props.visible}
          focusEnabled={props.focused}
          focusRequestId={props.focused ? props.workspace.terminalFocusRequestId : 0}
          onClosePanel={props.actions.close}
        />
      </Suspense>
    );
  if (props.id !== "browser" && !props.id.startsWith("browser:"))
    return <PanelStateMessage>This tab is unavailable.</PanelStateMessage>;
  return (
    <Suspense fallback={<PanelStateMessage loadingLabel="Loading browser" />}>
      <LazyBrowserPanel
        mode="sidebar"
        threadId={threadId}
        hideTabs
        runtimeMode="live"
        isVisible={props.visible}
        onClosePanel={props.actions.close}
      />
    </Suspense>
  );
}
