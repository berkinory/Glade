import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationShellSnapshot } from "@glade/contracts/orchestration/snapshots";
import { type ProviderModelOptions } from "@glade/contracts/provider/model";
import { type ProviderNativeCommandDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { type ModelSelection, type RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import type { ComposerTrigger } from "../composer-logic";
import type { Project, Thread } from "../types";
type ComposerSnapshot = { value: string; cursor: number; expandedCursor: number };
export type ComposerSlashCommandInput = {
  thread: {
    activeProject: Project | undefined;
    activeThread: Thread | undefined;
    activeRootBranch: string | null;
    isServerThread: boolean;
    isLocalDraftThread: boolean;
    environmentMode: string | null;
    runtimeMode: RuntimeMode;

    threadId: ThreadId;
    syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
    navigateToThread: (threadId: ThreadId) => Promise<void>;
    handleClearConversation: () => Promise<void> | void;
  };
  provider: {
    supportsFastSlashCommand: boolean;
    canOfferCompactCommand: boolean;
    canOfferExportCommand: boolean;
    supportsTextNativeReviewCommand: boolean;
    fastModeEnabled: boolean;
    providerNativeCommands: readonly ProviderNativeCommandDescriptor[];
    providerCommandDiscoveryCwd: string | null;
    selectedProvider: ProviderKind;
    currentProviderModelOptions: ProviderModelOptions[ProviderKind] | undefined;
    selectedModelSelection: ModelSelection;
    setComposerDraftProviderModelOptions: (
      threadId: ThreadId,
      provider: ProviderKind,
      nextProviderOptions: ProviderModelOptions[ProviderKind],
      options?: { persistSticky?: boolean },
    ) => void;
  };
  editor: {
    openForkTargetPicker: () => void;
    openReviewTargetPicker: () => void;
    editorActions: {
      resolveActiveComposerTrigger: () => {
        snapshot: ComposerSnapshot;
        trigger: ComposerTrigger | null;
      };
      applyPromptReplacement: (
        rangeStart: number,
        rangeEnd: number,
        replacement: string,
        options?: { expectedText?: string; cursorOffset?: number },
      ) => number | false;
      clearComposerSlashDraft: () => void;
      setComposerPromptValue: (nextPrompt: string) => void;
      scheduleComposerFocus: () => void;
      setComposerHighlightedItemId: (id: string | null) => void;
    };
  };
};
