import { hasOpenKeyboardOverlay } from "~/lib/keyboardOverlay";
import { ThreadId, type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ModelSlug } from "@glade/contracts/provider/model";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { readStarredModelSlugs } from "~/lib/starredModels";
import { isMacNavigatorPlatform } from "~/lib/utils";
import { projectScriptIdFromCommand } from "~/projectScripts";
import { isElectron } from "../../env";
import { resolveShortcutCommand } from "../../keybindings";
import { isEditableEventTarget } from "../../lib/editableEventTarget";
import { isTerminalFocused } from "../../lib/terminalFocus";
import type { Project } from "../../types";
import { type Thread } from "../../types";
import { resolveCycledModelSlug } from "../ChatView.logic.worktree";
import { collectForegroundRunningSubagentStripItems } from "./ComposerSubagentStrip.logic";
import { eventTargetsInAppBrowser, shouldCaptureChatFindShortcut } from "./threadFind.logic";
import { useChatProjectScripts } from "./useChatProjectScripts";
import { useChatProviderModels } from "./useChatProviderModels";
import type { ThreadTerminalState } from "~/terminalStateNormalization";
import { useChatWorkLog } from "./useChatWorkLog";
import { useComposerVoiceController } from "./useComposerVoiceController";
import { toastManager } from "../ui/toast";
function eventTargetsComposer(
  event: globalThis.KeyboardEvent,
  composerForm: HTMLFormElement | null,
): boolean {
  if (!composerForm) return false;
  const target = event.target;
  return target instanceof Node ? composerForm.contains(target) : false;
}

function canHandleComposerPickerShortcut(
  event: globalThis.KeyboardEvent,
  composerForm: HTMLFormElement | null,
): boolean {
  if (!composerForm) return false;
  if (eventTargetsComposer(event, composerForm)) return true;
  const target = event.target;
  return (
    target === document.body ||
    target === document.documentElement ||
    document.activeElement === document.body ||
    document.activeElement === document.documentElement
  );
}
interface ChatKeyboardShortcutsInput {
  onToggleTerminal?: () => void;
  onOpenTerminal?: () => void;
  expandTerminalWorkspace: () => void;
  onSplitSurface?: () => void;
  surfaceMode: "single" | "split";
  isFocusedPane: boolean;
  activeThreadId: ThreadId | null;
  hasLiveTurn: boolean;
  composerFormRef: RefObject<HTMLFormElement | null>;
  onInterruptFromStopControl: () => void;
  composerSubagentStripItems: ReturnType<typeof useChatWorkLog>["composerSubagentStripItems"];
  onBackgroundAllForegroundSubagentStripItems: () => Promise<void>;
  isVoiceRecording: ReturnType<typeof useComposerVoiceController>["isVoiceRecording"];
  isVoiceTranscribing: ReturnType<typeof useComposerVoiceController>["isVoiceTranscribing"];
  isComposerApprovalState: boolean;
  terminalState: ThreadTerminalState;
  terminalWorkspaceOpen: boolean;
  terminalWorkspaceTerminalTabActive: boolean;
  terminalWorkspaceChatTabActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  toggleComposerFocus: () => void;
  shouldRenderChatPaneContent: boolean;
  setThreadFindOpen: Dispatch<SetStateAction<boolean>>;
  setThreadFindFocusNonce: Dispatch<SetStateAction<number>>;
  cycleEffort: () => boolean;
  cancelEffortPreview: () => void;
  handleModelPickerOpenChange: (open: boolean) => void;
  scheduleComposerFocus: () => void;
  modelOptionsByProvider: ReturnType<typeof useChatProviderModels>["modelOptionsByProvider"];
  selectedProvider: ProviderKind;
  selectedModel: string;
  onProviderModelSelect: (provider: ProviderKind, model: ModelSlug) => Promise<void>;
  handleTraitsPickerOpenChange: (open: boolean) => void;
  toggleTerminalVisibility: () => void;
  setTerminalOpen: (open: boolean) => void;
  splitTerminalRight: () => void;
  splitTerminalLeft: () => void;
  splitTerminalDown: () => void;
  splitTerminalUp: () => void;
  closeTerminal: (terminalId: string) => Promise<void>;
  createTerminalFromShortcut: () => void;
  openNewFullWidthTerminal: () => void;
  closeActiveWorkspaceView: () => void;
  setTerminalWorkspaceTab: (tab: "terminal" | "chat") => void;
  onToggleDiff: () => void;
  commitAndPushTriggerRef: RefObject<(() => void) | null>;
  showGitActions: boolean;
  isGitRepo: boolean;
  onToggleBrowser: () => void;
  copyThreadIdToClipboard: (threadId: string) => void;
  activeProject: Project | undefined;
  runProjectScript: ReturnType<typeof useChatProjectScripts>["runProjectScript"];
  activeThread: Thread | undefined;
}

type ChatKeyboardShortcutsControllerInput = {
  props: Pick<ChatKeyboardShortcutsInput, "onToggleTerminal" | "onOpenTerminal" | "onSplitSurface">;
  workspace: Pick<
    ChatKeyboardShortcutsInput,
    | "expandTerminalWorkspace"
    | "activeThreadId"
    | "terminalState"
    | "terminalWorkspaceOpen"
    | "terminalWorkspaceTerminalTabActive"
    | "terminalWorkspaceChatTabActive"
    | "toggleTerminalVisibility"
    | "setTerminalOpen"
    | "splitTerminalRight"
    | "splitTerminalLeft"
    | "splitTerminalDown"
    | "splitTerminalUp"
    | "closeTerminal"
    | "createTerminalFromShortcut"
    | "openNewFullWidthTerminal"
    | "closeActiveWorkspaceView"
    | "setTerminalWorkspaceTab"
    | "activeProject"
  >;
  session: Pick<
    ChatKeyboardShortcutsInput,
    | "surfaceMode"
    | "isFocusedPane"
    | "composerFormRef"
    | "setThreadFindOpen"
    | "setThreadFindFocusNonce"
    | "commitAndPushTriggerRef"
    | "activeThread"
  >;
  provider: Pick<
    ChatKeyboardShortcutsInput,
    | "hasLiveTurn"
    | "composerSubagentStripItems"
    | "modelOptionsByProvider"
    | "selectedProvider"
    | "selectedModel"
  >;
  turn: Pick<
    ChatKeyboardShortcutsInput,
    | "onInterruptFromStopControl"
    | "onBackgroundAllForegroundSubagentStripItems"
    | "onProviderModelSelect"
    | "copyThreadIdToClipboard"
  >;
  composer: Pick<
    ChatKeyboardShortcutsInput,
    | "isVoiceRecording"
    | "isVoiceTranscribing"
    | "toggleComposerFocus"
    | "cycleEffort"
    | "cancelEffortPreview"
    | "handleModelPickerOpenChange"
    | "scheduleComposerFocus"
    | "handleTraitsPickerOpenChange"
  >;
  transcript: Pick<ChatKeyboardShortcutsInput, "isComposerApprovalState">;
  discovery: Pick<
    ChatKeyboardShortcutsInput,
    | "keybindings"
    | "shouldRenderChatPaneContent"
    | "onToggleDiff"
    | "showGitActions"
    | "isGitRepo"
    | "onToggleBrowser"
  >;
  environment: Pick<ChatKeyboardShortcutsInput, "runProjectScript">;
};
export function useChatKeyboardShortcuts({
  props,
  workspace,
  session,
  provider,
  turn,
  composer,
  transcript,
  discovery,
  environment,
}: ChatKeyboardShortcutsControllerInput) {
  const { onToggleTerminal, onOpenTerminal, onSplitSurface } = props;
  const {
    expandTerminalWorkspace,
    activeThreadId,
    terminalState,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    terminalWorkspaceChatTabActive,
    toggleTerminalVisibility,
    setTerminalOpen,
    splitTerminalRight,
    splitTerminalLeft,
    splitTerminalDown,
    splitTerminalUp,
    closeTerminal,
    createTerminalFromShortcut,
    openNewFullWidthTerminal,
    closeActiveWorkspaceView,
    setTerminalWorkspaceTab,
    activeProject,
  } = workspace;
  const {
    surfaceMode,
    isFocusedPane,
    composerFormRef,
    setThreadFindOpen,
    setThreadFindFocusNonce,
    commitAndPushTriggerRef,
    activeThread,
  } = session;
  const {
    hasLiveTurn,
    composerSubagentStripItems,
    modelOptionsByProvider,
    selectedProvider,
    selectedModel,
  } = provider;
  const {
    onInterruptFromStopControl,
    onBackgroundAllForegroundSubagentStripItems,
    onProviderModelSelect,
    copyThreadIdToClipboard,
  } = turn;
  const {
    isVoiceRecording,
    isVoiceTranscribing,
    toggleComposerFocus,
    cycleEffort,
    cancelEffortPreview,
    handleModelPickerOpenChange,
    scheduleComposerFocus,
    handleTraitsPickerOpenChange,
  } = composer;
  const { isComposerApprovalState } = transcript;
  const {
    keybindings,
    shouldRenderChatPaneContent,
    onToggleDiff,
    showGitActions,
    isGitRepo,
    onToggleBrowser,
  } = discovery;
  const { runProjectScript } = environment;
  useEffect(() => {
    const revealTerminal = () => {
      if (onOpenTerminal) {
        onOpenTerminal();
      } else if (surfaceMode === "split") {
        expandTerminalWorkspace();
      }
    };
    if (surfaceMode === "split" && !isFocusedPane) {
      return;
    }

    const terminalSplitActions = new Map([
      ["terminal.split", splitTerminalRight],
      ["terminal.splitRight", splitTerminalRight],
      ["terminal.splitLeft", splitTerminalLeft],
      ["terminal.splitDown", splitTerminalDown],
      ["terminal.splitUp", splitTerminalUp],
    ]);
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || event.defaultPrevented || event.isComposing) return;
      const picker = document.querySelector<HTMLElement>("[data-model-picker-popup]");
      const effortCommand =
        resolveShortcutCommand(event, keybindings, {
          context: { terminalFocus: isTerminalFocused() },
        }) === "model.effort.next";
      if (effortCommand) {
        if (
          isTerminalFocused() ||
          isVoiceRecording ||
          isVoiceTranscribing ||
          isComposerApprovalState ||
          hasOpenKeyboardOverlay(picker)
        )
          return;
        if (
          !eventTargetsComposer(event, composerFormRef.current) &&
          !(event.target instanceof Node && picker?.contains(event.target))
        )
          return;
        if (cycleEffort()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (picker && event.target instanceof Node && picker.contains(event.target))
        cancelEffortPreview();
      if (hasOpenKeyboardOverlay()) return;

      if (
        hasLiveTurn &&
        isMacNavigatorPlatform() &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "c" &&
        eventTargetsComposer(event, composerFormRef.current)
      ) {
        event.preventDefault();
        event.stopPropagation();
        onInterruptFromStopControl();
        return;
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "b" &&
        !isTerminalFocused() &&
        !isEditableEventTarget(event) &&
        collectForegroundRunningSubagentStripItems(composerSubagentStripItems).length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        void onBackgroundAllForegroundSubagentStripItems();
        return;
      }
      const composerPickerShortcutActive =
        !isTerminalFocused() &&
        !isVoiceRecording &&
        !isVoiceTranscribing &&
        !isComposerApprovalState &&
        canHandleComposerPickerShortcut(event, composerFormRef.current);
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
        terminalWorkspaceOpen,
        terminalWorkspaceTerminalOnly: terminalState.workspaceLayout === "terminal-only",
        terminalWorkspaceTerminalTabActive,
        terminalWorkspaceChatTabActive,
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "composer.focus.toggle") {
        if (isComposerApprovalState || isVoiceRecording || isVoiceTranscribing) return;
        event.preventDefault();
        event.stopPropagation();
        toggleComposerFocus();
        return;
      }

      if (command === "chat.find") {
        if (
          event
            .composedPath()
            .some(
              (target) =>
                target instanceof Element && target.hasAttribute("data-workspace-file-editor"),
            )
        )
          return;
        if (
          !shouldCaptureChatFindShortcut({
            shouldRenderChatPaneContent,
            terminalWorkspaceTerminalTabActive,
            inAppBrowserFocused: eventTargetsInAppBrowser(event.target),
          })
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setThreadFindOpen(true);
        setThreadFindFocusNonce((current) => current + 1);
        return;
      }

      if (command === "modelPicker.toggle") {
        if (!composerPickerShortcutActive) return;
        event.preventDefault();
        event.stopPropagation();
        handleModelPickerOpenChange(true);
        scheduleComposerFocus();
        return;
      }

      if (command === "model.next" || command === "model.previous") {
        if (!composerPickerShortcutActive) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = command === "model.next" ? "next" : "previous";
        const providerOptions = modelOptionsByProvider[selectedProvider] ?? [];
        const nextSlug = resolveCycledModelSlug({
          currentModel: selectedModel,
          options: providerOptions,
          favoriteSlugs: readStarredModelSlugs(selectedProvider),
          direction,
        });
        if (!nextSlug) return;
        void onProviderModelSelect(selectedProvider, nextSlug as ModelSlug);
        return;
      }

      if (command === "traitsPicker.toggle") {
        if (!composerPickerShortcutActive) return;
        event.preventDefault();
        event.stopPropagation();
        handleTraitsPickerOpenChange(true);
        scheduleComposerFocus();
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (onToggleTerminal) {
          onToggleTerminal();
        } else if (surfaceMode === "split") {
          if (terminalWorkspaceOpen) {
            setTerminalOpen(false);
          } else {
            setTerminalOpen(true);
            expandTerminalWorkspace();
          }
        } else {
          toggleTerminalVisibility();
        }
        return;
      }

      const splitTerminal = terminalSplitActions.get(command);
      if (splitTerminal) {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        revealTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        void closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        createTerminalFromShortcut();
        revealTerminal();
        return;
      }

      if (command === "terminal.workspace.newFullWidth") {
        event.preventDefault();
        event.stopPropagation();
        if (onOpenTerminal) {
          createTerminalFromShortcut();
          onOpenTerminal();
        } else {
          openNewFullWidthTerminal();
        }
        return;
      }

      if (command === "terminal.workspace.closeActive") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveWorkspaceView();
        return;
      }

      if (command === "terminal.workspace.terminal") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalWorkspaceOpen) return;
        setTerminalWorkspaceTab("terminal");
        return;
      }

      if (command === "terminal.workspace.chat") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalWorkspaceOpen) return;
        setTerminalWorkspaceTab("chat");
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      if (command === "git.commitAndPush") {
        if (commitAndPushTriggerRef.current) {
          event.preventDefault();
          event.stopPropagation();
          commitAndPushTriggerRef.current();
          return;
        }

        if (showGitActions && isGitRepo) {
          event.preventDefault();
          event.stopPropagation();
          toastManager.add({
            type: "info",
            title: "Nothing to commit or push.",
          });
        }
        return;
      }

      if (command === "browser.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!isElectron) return;
        onToggleBrowser();
        return;
      }

      if (command === "chat.split") {
        event.preventDefault();
        event.stopPropagation();
        if (surfaceMode === "single" && onSplitSurface) {
          onSplitSurface();
        }
        return;
      }

      if (command === "thread.copyId") {
        event.preventDefault();
        event.stopPropagation();
        copyThreadIdToClipboard(activeThreadId);
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [
    composerFormRef,
    setThreadFindOpen,
    setThreadFindFocusNonce,
    commitAndPushTriggerRef,
    activeProject,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    terminalState.workspaceLayout,
    activeThreadId,
    closeTerminal,
    closeActiveWorkspaceView,
    createTerminalFromShortcut,
    setTerminalOpen,
    openNewFullWidthTerminal,
    runProjectScript,
    keybindings,
    splitTerminalDown,
    splitTerminalLeft,
    splitTerminalRight,
    splitTerminalUp,
    terminalWorkspaceChatTabActive,
    terminalWorkspaceOpen,
    terminalWorkspaceTerminalTabActive,
    onToggleBrowser,
    onToggleDiff,
    onInterruptFromStopControl,
    onSplitSurface,
    showGitActions,
    isGitRepo,
    composerSubagentStripItems,
    onBackgroundAllForegroundSubagentStripItems,
    isFocusedPane,
    hasLiveTurn,
    cycleEffort,
    cancelEffortPreview,
    handleModelPickerOpenChange,
    handleTraitsPickerOpenChange,
    shouldRenderChatPaneContent,
    isComposerApprovalState,
    isVoiceRecording,
    isVoiceTranscribing,
    setTerminalWorkspaceTab,
    surfaceMode,
    scheduleComposerFocus,
    toggleComposerFocus,
    toggleTerminalVisibility,
    onToggleTerminal,
    onOpenTerminal,
    expandTerminalWorkspace,
    activeThread,
    selectedProvider,
    selectedModel,
    modelOptionsByProvider,
    onProviderModelSelect,
    copyThreadIdToClipboard,
  ]);
}
