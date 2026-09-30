import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import { resolveTerminalNewAction } from "~/lib/terminalNewAction";
import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "~/lib/terminalCloseConfirmation";
import { readNativeApi } from "~/nativeApi";
import { collectTerminalIdsFromLayout } from "~/terminalPaneLayout";
import type { ThreadTerminalState } from "~/terminalStateNormalization";
import { useTerminalStateStore } from "~/terminalStateStore";
import { MAX_TERMINALS_PER_GROUP } from "~/types";
import { randomTerminalId } from "../terminal/terminalIds";
import { disposeAndCloseTerminalSession } from "../terminal/terminalSession";

export interface ChatTerminalActionContext {
  activeThreadId: ThreadId | null;
  requestTerminalFocus: () => void;
}

export interface ChatTerminalProjectActionContext extends ChatTerminalActionContext {
  activeProjectPresent: boolean;
}

export interface ChatTerminalCloseActionContext extends ChatTerminalActionContext {
  confirmTerminalClose: boolean;
}

const terminalStore = () => useTerminalStateStore.getState();

export function setChatTerminalOpen(ctx: ChatTerminalActionContext, open: boolean): void {
  if (ctx.activeThreadId) terminalStore().setTerminalOpen(ctx.activeThreadId, open);
}

export function setChatTerminalWorkspaceTab(
  ctx: ChatTerminalActionContext,
  tab: "terminal" | "chat",
): void {
  if (ctx.activeThreadId) terminalStore().setTerminalWorkspaceTab(ctx.activeThreadId, tab);
}

export function setChatTerminalHeight(ctx: ChatTerminalActionContext, height: number): void {
  if (ctx.activeThreadId) terminalStore().setTerminalHeight(ctx.activeThreadId, height);
}

export function toggleChatTerminalVisibility(
  ctx: ChatTerminalActionContext,
  state: ThreadTerminalState,
): void {
  if (!ctx.activeThreadId) return;
  if (!state.terminalOpen)
    terminalStore().setTerminalPresentationMode(ctx.activeThreadId, "drawer");
  setChatTerminalOpen(ctx, !state.terminalOpen);
}

export function expandChatTerminalWorkspace(ctx: ChatTerminalActionContext): void {
  if (!ctx.activeThreadId) return;
  terminalStore().setTerminalPresentationMode(ctx.activeThreadId, "workspace");
  terminalStore().setTerminalWorkspaceLayout(ctx.activeThreadId, "both");
  setChatTerminalWorkspaceTab(ctx, "terminal");
}

export function collapseChatTerminalWorkspace(ctx: ChatTerminalActionContext): void {
  if (ctx.activeThreadId) terminalStore().setTerminalPresentationMode(ctx.activeThreadId, "drawer");
}

export function splitChatTerminal(
  ctx: ChatTerminalActionContext,
  state: ThreadTerminalState,
  direction: "left" | "right" | "down" | "up",
): void {
  if (!ctx.activeThreadId) return;
  const activeGroup =
    state.terminalGroups.find((group) => group.id === state.activeTerminalGroupId) ??
    state.terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(state.activeTerminalId),
    );
  if (
    (activeGroup ? collectTerminalIdsFromLayout(activeGroup.layout).length : 0) >=
    MAX_TERMINALS_PER_GROUP
  )
    return;
  const store = terminalStore();
  const split = {
    left: store.splitTerminalLeft,
    right: store.splitTerminalRight,
    down: store.splitTerminalDown,
    up: store.splitTerminalUp,
  }[direction];
  split(ctx.activeThreadId, randomTerminalId());
  ctx.requestTerminalFocus();
}

export function createChatTerminal(ctx: ChatTerminalActionContext): void {
  if (!ctx.activeThreadId) return;
  terminalStore().newTerminal(ctx.activeThreadId, randomTerminalId());
  ctx.requestTerminalFocus();
}

export function createChatTerminalTab(
  ctx: ChatTerminalActionContext,
  targetTerminalId: string,
): void {
  if (!ctx.activeThreadId) return;
  terminalStore().newTerminalTab(ctx.activeThreadId, targetTerminalId, randomTerminalId());
  ctx.requestTerminalFocus();
}

export function createChatTerminalFromShortcut(
  ctx: ChatTerminalActionContext,
  state: ThreadTerminalState,
): void {
  const action = resolveTerminalNewAction(state);
  if (action.kind === "new-group") {
    if (!state.terminalOpen) setChatTerminalOpen(ctx, true);
    createChatTerminal(ctx);
    return;
  }
  createChatTerminalTab(ctx, action.targetTerminalId);
}

export function moveChatTerminalToNewGroup(
  ctx: ChatTerminalActionContext,
  terminalId: string,
): void {
  if (!ctx.activeThreadId) return;
  terminalStore().newTerminal(ctx.activeThreadId, terminalId);
  ctx.requestTerminalFocus();
}

export function openNewFullWidthChatTerminal(ctx: ChatTerminalProjectActionContext): void {
  if (!ctx.activeThreadId || !ctx.activeProjectPresent) return;
  terminalStore().openNewFullWidthTerminal(ctx.activeThreadId, randomTerminalId());
  ctx.requestTerminalFocus();
}

export function activateChatTerminal(ctx: ChatTerminalActionContext, terminalId: string): void {
  if (!ctx.activeThreadId) return;
  terminalStore().setActiveTerminal(ctx.activeThreadId, terminalId);
  ctx.requestTerminalFocus();
}

export async function closeChatTerminal(
  ctx: ChatTerminalCloseActionContext,
  state: ThreadTerminalState,
  terminalId: string,
): Promise<void> {
  const api = readNativeApi();
  if (!ctx.activeThreadId || !api) return;
  const confirmed = await confirmTerminalTabClose({
    api,
    enabled: shouldPromptForTerminalClose({
      confirmationEnabled: ctx.confirmTerminalClose,
      runningTerminalIds: state.runningTerminalIds,
      terminalAttentionStatesById: state.terminalAttentionStatesById,
      terminalId,
    }),
    terminalTitle: resolveTerminalCloseTitle({
      terminalId,
      terminalLabelsById: state.terminalLabelsById,
      terminalTitleOverridesById: state.terminalTitleOverridesById,
    }),
  });
  if (!confirmed) return;
  disposeAndCloseTerminalSession({
    api,
    threadId: ctx.activeThreadId,
    terminalId,
    clearHistoryBeforeClose: state.terminalIds.length <= 1,
  });
  terminalStore().closeTerminal(ctx.activeThreadId, terminalId);
  ctx.requestTerminalFocus();
}

export function handleChatTerminalSessionExited(
  ctx: ChatTerminalActionContext,
  state: ThreadTerminalState,
  terminalId: string,
): void {
  if (!ctx.activeThreadId) return;
  disposeAndCloseTerminalSession({
    api: readNativeApi(),
    threadId: ctx.activeThreadId,
    terminalId,
    clearHistoryBeforeClose: state.terminalIds.length <= 1,
    processAlreadyExited: true,
  });
  terminalStore().closeTerminal(ctx.activeThreadId, terminalId);
  ctx.requestTerminalFocus();
}

export function closeActiveChatTerminalWorkspaceView(
  ctx: ChatTerminalCloseActionContext,
  state: ThreadTerminalState,
): void {
  if (!ctx.activeThreadId || state.presentationMode !== "workspace" || !state.terminalOpen) return;
  if (state.workspaceLayout === "both" && state.workspaceActiveTab === "chat") {
    if (state.entryPoint === "chat") collapseChatTerminalWorkspace(ctx);
    else terminalStore().closeWorkspaceChat(ctx.activeThreadId);
    return;
  }
  void closeChatTerminal(ctx, state, state.activeTerminalId);
}
