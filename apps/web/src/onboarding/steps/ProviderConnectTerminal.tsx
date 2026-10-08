import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { useEffect, useRef } from "react";

import ThreadTerminalDrawer from "~/components/ThreadTerminalDrawer";
import { closeTerminalSession } from "~/components/terminal/terminalSession";
import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { readNativeApi } from "~/nativeApi";
import { runTerminalCommand } from "~/components/terminal/runTerminalCommand";
import { useTerminalStateStore } from "~/terminalStateStore";
import { onboardingTerminalThreadId } from "../onboardingTerminalScope";

const CONNECT_TERMINAL_HEIGHT = 280;

export function ProviderConnectTerminal(props: {
  provider: ProviderKind;
  signInCommand: string;
  cwd: string;
}) {
  const scopeId = onboardingTerminalThreadId(props.provider);
  const terminal = useTerminalSurfaceController(scopeId);
  const { terminalState, openTerminalThreadPage } = terminal;
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const terminalIdsRef = useRef(terminalState.terminalIds);
  terminalIdsRef.current = terminalState.terminalIds;

  useEffect(
    () => () => {
      const api = readNativeApi();
      for (const terminalId of terminalIdsRef.current) {
        closeTerminalSession({ api, threadId: scopeId, terminalId });
      }
      clearTerminalState(scopeId);
    },
    [clearTerminalState, scopeId],
  );

  useEffect(() => {
    if (terminalState.terminalOpen) {
      return;
    }
    openTerminalThreadPage(scopeId, { terminalOnly: true });
  }, [openTerminalThreadPage, scopeId, terminalState.terminalOpen]);

  const commandStartedRef = useRef(false);
  const activeTerminalId = terminalState.activeTerminalId || terminalState.terminalIds[0];
  useEffect(() => {
    if (commandStartedRef.current || !terminalState.terminalOpen || !activeTerminalId) {
      return;
    }
    const api = readNativeApi();
    if (!api || props.cwd.length === 0) {
      return;
    }
    commandStartedRef.current = true;
    void runTerminalCommand({
      api,
      threadId: scopeId,
      terminalId: activeTerminalId,
      cwd: props.cwd,
      command: props.signInCommand,
    }).catch(() => {
      commandStartedRef.current = false;
    });
  }, [activeTerminalId, props.cwd, props.signInCommand, scopeId, terminalState.terminalOpen]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <ThreadTerminalDrawer
        key={scopeId}
        threadId={scopeId}
        cwd={props.cwd}
        runtimeEnv={{}}
        height={CONNECT_TERMINAL_HEIGHT}
        presentationMode="workspace"
        isVisible
        terminalIds={terminalState.terminalIds}
        terminalLabelsById={terminalState.terminalLabelsById}
        terminalTitleOverridesById={terminalState.terminalTitleOverridesById}
        terminalCliKindsById={terminalState.terminalCliKindsById}
        terminalAttentionStatesById={terminalState.terminalAttentionStatesById ?? {}}
        runningTerminalIds={terminalState.runningTerminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        focusRequestId={terminal.focusRequestId}
        onTerminalSessionExited={terminal.handleTerminalSessionExited}
        onHeightChange={terminal.setTerminalHeight}
        onTerminalMetadataChange={terminal.setTerminalMetadata}
        onTerminalActivityChange={terminal.setTerminalActivity}
      />
    </div>
  );
}
