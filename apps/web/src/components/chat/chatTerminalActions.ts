import type { ThreadId } from "@glade/contracts/core/baseSchemas";

import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "~/lib/terminalCloseConfirmation";
import { readNativeApi } from "~/nativeApi";
import type { ThreadTerminalState } from "~/terminalStateNormalization";
import { useTerminalStateStore } from "~/terminalStateStore";
import { randomTerminalId } from "../terminal/terminalIds";
import { closeTerminalSession } from "../terminal/terminalSession";

export interface ChatTerminalActionContext {
  activeThreadId: ThreadId | null;
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

export function toggleChatTerminalVisibility(
  ctx: ChatTerminalActionContext,
  state: ThreadTerminalState,
): void {
  if (!ctx.activeThreadId) return;
  if (!state.terminalOpen)
    terminalStore().setTerminalPresentationMode(ctx.activeThreadId, "drawer");
  setChatTerminalOpen(ctx, !state.terminalOpen);
}

function collapseChatTerminalWorkspace(ctx: ChatTerminalActionContext): void {
  if (ctx.activeThreadId) terminalStore().setTerminalPresentationMode(ctx.activeThreadId, "drawer");
}

function createChatTerminal(ctx: ChatTerminalActionContext): void {
  if (!ctx.activeThreadId) return;
  terminalStore().newTerminal(ctx.activeThreadId, randomTerminalId());
}
export function createChatTerminalFromShortcut(ctx: ChatTerminalActionContext): void {
  createChatTerminal(ctx);
}

export function openNewFullWidthChatTerminal(ctx: ChatTerminalProjectActionContext): void {
  if (!ctx.activeThreadId || !ctx.activeProjectPresent) return;
  terminalStore().openNewFullWidthTerminal(ctx.activeThreadId, randomTerminalId());
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
  const threadId = ctx.activeThreadId;
  closeTerminalSession({ api, threadId, terminalId });
  terminalStore().closeTerminal(threadId, terminalId);
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
