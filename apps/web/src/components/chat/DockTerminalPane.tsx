import { terminalRuntimeEnv } from "~/lib/terminalRuntimeEnv";
import { type ProjectId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveThreadWorkspaceCwd } from "@glade/shared/threads/threadEnvironment";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "~/lib/chatPaneScope";
import {
  getTerminalContextComposerTarget,
  subscribeTerminalContextComposerTarget,
} from "~/lib/terminalContextComposerRegistry";
import { useStore } from "~/store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "~/storeSelectors";
import { useTerminalStateStore } from "~/terminalStateStore";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";

function DockTerminalPane(props: {
  workspaceRoot?: string | null;
  focusRequestId?: number;
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
    props.workspaceRoot ??
    resolveThreadWorkspaceCwd({
      projectCwd,
      envMode: threadWorkspace.envMode,
      worktreePath,
      workingDirectory,
    }) ??
    "";
  const runtimeProjectCwd = workingDirectory ?? projectCwd;
  const runtimeEnv = runtimeProjectCwd
    ? terminalRuntimeEnv({ cwd: runtimeProjectCwd, worktreePath })
    : {};

  const terminal = useTerminalSurfaceController(scopeId);
  const { terminalState } = terminal;
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

  const onSessionExited = (terminalId: string) => {
    const disposition = terminal.handleDockTerminalSessionExited(terminalId);
    if (disposition === "final") {
      closingFinalTerminalRef.current = true;
      props.onClosePanel();
    }
  };

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
      focusRequestId={terminal.focusRequestId + (props.focusRequestId ?? 0)}
      onTerminalSessionExited={onSessionExited}
      onHeightChange={terminal.setTerminalHeight}
      onTerminalMetadataChange={terminal.setTerminalMetadata}
      onTerminalActivityChange={terminal.setTerminalActivity}
      onAddTerminalContext={composerTarget}
    />
  );
}

export default DockTerminalPane;
