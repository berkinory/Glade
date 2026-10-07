import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { lazy, Suspense, useEffect, useEffectEvent, useState } from "react";
import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import {
  ComputerTerminal01Icon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
} from "~/lib/icons";
import { resolveTerminalCloseTitle } from "~/lib/terminalCloseConfirmation";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isMacNavigatorPlatform } from "~/lib/utils";
import { terminalTabGroups, type TerminalSplitDirection } from "~/terminalLayout";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { PanelTabBar } from "../chat/PanelTabBar";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

const DockTerminalPane = lazy(() => import("../chat/DockTerminalPane"));

const reportCloseError = (error: unknown) =>
  toastManager.add({
    type: "error",
    title: "Could not close terminal",
    description: String(error),
  });

function TerminalSplitButton(props: {
  direction: TerminalSplitDirection;
  onSplit: (direction: TerminalSplitDirection) => void;
}) {
  const sideBySide = props.direction === "vertical";
  const Icon = sideBySide ? SquareSplitHorizontalIcon : SquareSplitVerticalIcon;
  const label = sideBySide ? "Split terminal vertically" : "Split terminal horizontally";
  const mac = isMacNavigatorPlatform();
  const shortcut = sideBySide ? (mac ? "⌘D" : "Ctrl+D") : mac ? "⌘⇧D" : "Ctrl+Shift+D";
  return (
    <IconButton
      label={label}
      tooltip={`${label} (${shortcut})`}
      tooltipSide="bottom"
      onClick={() => props.onSplit(props.direction)}
    >
      <Icon className="size-3.5" />
    </IconButton>
  );
}

// Split and Cmd/Ctrl+W act on the focused shell; Cmd/Ctrl+W elsewhere closes workspace tabs.
function useTerminalViewShortcuts(props: {
  visible: boolean;
  onSplit: (direction: TerminalSplitDirection) => void;
  onClose: () => void;
}) {
  const split = useEffectEvent((event: KeyboardEvent) => {
    if (
      !props.visible ||
      !isTerminalFocused() ||
      event.isComposing ||
      event.repeat ||
      event.altKey ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== "d"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    props.onSplit(event.shiftKey ? "horizontal" : "vertical");
  });
  const close = useEffectEvent(() => {
    if (props.visible && isTerminalFocused()) props.onClose();
  });
  useEffect(() => {
    window.addEventListener("glade:close-workspace-tab", close);
    window.addEventListener("keydown", split, true);
    const unsubscribe = window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "close-workspace-tab") close();
    });
    return () => {
      window.removeEventListener("glade:close-workspace-tab", close);
      window.removeEventListener("keydown", split, true);
      unsubscribe?.();
    };
  }, []);
}

// The thread's terminals with their own tab row. Shells start the first time the view shows and
// stay attached while hidden, until the last one closes.
export function TerminalView(props: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  visible: boolean;
  onLastClosed: () => void;
}) {
  const terminal = useTerminalSurfaceController(props.threadId);
  const { terminalState } = terminal;
  const [sessionsMounted, setSessionsMounted] = useState(props.visible);
  if (props.visible && !sessionsMounted) setSessionsMounted(true);
  const closeLast = () => {
    setSessionsMounted(false);
    props.onLastClosed();
  };
  const groups = terminalTabGroups(terminalState);
  const activeGroup = groups.find((group) =>
    group.terminalIds.includes(terminalState.activeTerminalId),
  );
  useTerminalViewShortcuts({
    visible: props.visible,
    onSplit: terminal.splitTerminal,
    onClose: () => {
      terminal.closeTerminal(terminalState.activeTerminalId, closeLast).catch(reportCloseError);
    },
  });
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PanelTabBar
        label="Terminal tabs"
        contentTabs
        tabs={groups.map((group) => ({
          id: group.id,
          label: resolveTerminalCloseTitle({ terminalId: group.terminalIds[0]!, ...terminalState }),
          icon: <ComputerTerminal01Icon className="size-3.5" />,
          trailing: group.terminalIds.some((id) =>
            terminalState.runningTerminalIds.includes(id),
          ) ? (
            <Spinner className="size-3" aria-label="Terminal running" />
          ) : null,
          onClose: () => {
            terminal.closeTerminalGroup(group.terminalIds, closeLast).catch(reportCloseError);
          },
        }))}
        activeId={activeGroup?.id ?? null}
        onSelect={(id) => {
          const group = groups.find((tab) => tab.id === id);
          if (group && group !== activeGroup) terminal.activateTerminal(group.terminalIds[0]!);
        }}
        actions={
          <div className="flex items-center gap-1">
            <TerminalSplitButton direction="horizontal" onSplit={terminal.splitTerminal} />
            <TerminalSplitButton direction="vertical" onSplit={terminal.splitTerminal} />
            <IconButton
              label="New terminal"
              tooltip="New terminal"
              tooltipSide="bottom"
              onClick={terminal.createTerminal}
            >
              <PlusIcon className="size-3.5" />
            </IconButton>
          </div>
        }
      />
      <div className="relative min-h-0 flex-1">
        {sessionsMounted ? (
          <Suspense fallback={<PanelStateMessage loadingLabel="Loading terminal" />}>
            <DockTerminalPane
              hostThreadId={props.threadId}
              projectId={props.projectId}
              workspaceRoot={props.workspaceRoot}
              isActive={props.visible}
              focusRequestId={terminal.focusRequestId}
              onClosePanel={closeLast}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
