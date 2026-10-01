import { type ProjectId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadWorkspaceCwd } from "@glade/shared/threads/threadEnvironment";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "~/lib/chatPaneScope";
import {
  getTerminalContextComposerTarget,
  subscribeTerminalContextComposerTarget,
} from "~/lib/terminalContextComposerRegistry";
import { projectScriptRuntimeEnv } from "~/projectScripts";
import { useStore } from "~/store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "~/storeSelectors";
import { useTerminalStateStore } from "~/terminalStateStore";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";

function DockTerminalPane(props: {
  hostThreadId: ThreadId;
  projectId: ProjectId | null;

  isActive?: boolean;
  onClosePanel: () => void;
}) {
  const scopeId = props.hostThreadId;
  const threadWorkspace = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(props.hostThreadId), [props.hostThreadId]),
  );
  const project = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const worktreePath = threadWorkspace.worktreePath;
  const workingDirectory = threadWorkspace.workingDirectory;
  const projectCwd = project?.cwd ?? null;
  const cwd =
    resolveThreadWorkspaceCwd({
      projectCwd,
      envMode: threadWorkspace.envMode,
      worktreePath,
      workingDirectory,
    }) ?? "";
  const runtimeProjectCwd = workingDirectory ?? projectCwd;
  const runtimeEnv = runtimeProjectCwd
    ? projectScriptRuntimeEnv({ project: { cwd: runtimeProjectCwd }, worktreePath })
    : {};

  const terminal = useTerminalSurfaceController(scopeId);
  const { terminalState, bumpFocusRequest, newTerminalGroup } = terminal;
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const closingFinalTerminalRef = useRef(false);
  const subscribeToComposerTarget = useCallback(
    (listener: () => void) =>
      subscribeTerminalContextComposerTarget(SINGLE_CHAT_PANE_SCOPE_ID, listener),
    [],
  );
  const readComposerTarget = useCallback(
    () => getTerminalContextComposerTarget(SINGLE_CHAT_PANE_SCOPE_ID),
    [],
  );
  const composerTarget = useSyncExternalStore(
    subscribeToComposerTarget,
    readComposerTarget,
    readComposerTarget,
  );

  useEffect(() => {
    if (!props.isActive || terminalState.terminalOpen || closingFinalTerminalRef.current) {
      return;
    }
    setTerminalOpen(scopeId, true);
  }, [props.isActive, scopeId, setTerminalOpen, terminalState.terminalOpen]);

  const createTerminal = () => {
    closingFinalTerminalRef.current = false;
    if (!terminalState.terminalOpen) {
      setTerminalOpen(scopeId, true);
      bumpFocusRequest();
      return;
    }
    newTerminalGroup();
  };

  const onSessionExited = (terminalId: string) => {
    const disposition = terminal.handleDockTerminalSessionExited(terminalId);
    if (disposition === "final") {
      closingFinalTerminalRef.current = true;
      props.onClosePanel();
    }
  };

  const onCloseTerminal = (terminalId: string) =>
    terminal.closeTerminal(terminalId, () => {
      closingFinalTerminalRef.current = true;
      props.onClosePanel();
    });

  return (
    <ThreadTerminalDrawer
      key={scopeId}
      threadId={scopeId}
      cwd={cwd}
      runtimeEnv={runtimeEnv}
      height={terminalState.terminalHeight}
      presentationMode="workspace"
      isVisible={props.isActive ?? true}
      terminalIds={terminalState.terminalIds}
      terminalLabelsById={terminalState.terminalLabelsById}
      terminalTitleOverridesById={terminalState.terminalTitleOverridesById}
      terminalCliKindsById={terminalState.terminalCliKindsById}
      terminalAttentionStatesById={terminalState.terminalAttentionStatesById ?? {}}
      runningTerminalIds={terminalState.runningTerminalIds}
      activeTerminalId={terminalState.activeTerminalId}
      terminalGroups={terminalState.terminalGroups}
      activeTerminalGroupId={terminalState.activeTerminalGroupId}
      focusRequestId={terminal.focusRequestId}
      onSplitTerminal={terminal.splitRight}
      onSplitTerminalDown={terminal.splitDown}
      onNewTerminal={createTerminal}
      onNewTerminalTab={terminal.createTerminalTab}
      onMoveTerminalToGroup={terminal.moveTerminalToNewGroup}
      onActiveTerminalChange={terminal.activateTerminal}
      onCloseTerminal={(...args: Parameters<typeof onCloseTerminal>) => {
        void onCloseTerminal(...args).catch((error: unknown) =>
          console.error("[terminal] Could not close terminal", error),
        );
      }}
      onTerminalSessionExited={onSessionExited}
      onCloseTerminalGroup={terminal.closeTerminalGroup}
      onHeightChange={terminal.setTerminalHeight}
      onResizeTerminalSplit={terminal.resizeTerminalSplit}
      onTerminalMetadataChange={terminal.setTerminalMetadata}
      onTerminalActivityChange={terminal.setTerminalActivity}
      onAddTerminalContext={composerTarget}
    />
  );
}

export default DockTerminalPane;
