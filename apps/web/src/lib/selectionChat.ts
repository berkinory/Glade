import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadEnvironmentMode } from "@glade/contracts/orchestration/threadEntities";

import { requestComposerFocus, useComposerDraftStore } from "../composerDraftStore";
import type { QueuedComposerChatTurn } from "../composerDraftDomain";
import { ensureNativeApi } from "../nativeApi";
import { useProjectPreferencesStore } from "../projectPreferencesStore";
import { createAssistantSelectionAttachment } from "./assistantSelections";
import type { NewThreadOptions } from "./threadBootstrap";
import { randomUUID } from "./utils";
import type { TranscriptAssistantSelection } from "../components/chat/chatSelectionActions";

function requireSelection(selection: TranscriptAssistantSelection) {
  const attachment = createAssistantSelectionAttachment(selection);
  if (!attachment) throw new Error("Select between 1 and 4,000 characters.");
  return attachment;
}

type SelectionChatSettings = Pick<
  QueuedComposerChatTurn,
  "modelSelection" | "selectedPromptEffort" | "providerOptionsForDispatch" | "runtimeMode"
>;

export async function startSelectionChat(
  input: SelectionChatSettings & {
    projectId: ProjectId;
    projectCwd: string;
    selection: TranscriptAssistantSelection;
    prompt: string;
    envMode: ThreadEnvironmentMode;
    intent?: "send" | "compose";
    createThread: (projectId: ProjectId, options: NewThreadOptions) => Promise<ThreadId | null>;
  },
): Promise<void> {
  const attachment = requireSelection(input.selection);
  const prompt = input.prompt.trim();
  if (!prompt && input.intent !== "compose") throw new Error("Write a message for the new chat.");

  let branch: string | null = null;
  if (input.envMode === "worktree") {
    const status = await ensureNativeApi().git.status({ cwd: input.projectCwd });
    branch = status.branch;
    if (!branch) throw new Error("Check out a branch before starting a new worktree.");
  }
  const threadId = await input.createThread(input.projectId, {
    fresh: true,
    envMode: input.envMode,
    branch,
    worktreePath: null,
    workingDirectory: null,
  });
  if (!threadId) throw new Error("Could not open the new chat. Try again.");

  const drafts = useComposerDraftStore.getState();
  drafts.setModelSelection(threadId, input.modelSelection);
  drafts.setRuntimeMode(threadId, input.runtimeMode);

  useProjectPreferencesStore.getState().setProjectEnvMode(input.projectId, input.envMode);
  if (input.intent === "compose") {
    drafts.setPrompt(threadId, input.prompt);
    drafts.addAssistantSelection(threadId, attachment);
    requestComposerFocus(threadId);
    return;
  }

  drafts.enqueueQueuedTurn(threadId, {
    id: randomUUID(),
    kind: "chat",
    createdAt: new Date().toISOString(),
    previewText: prompt,
    prompt,
    assistantSelections: [attachment],
    images: [],
    files: [],
    terminalContexts: [],
    fileComments: [],
    pastedTexts: [],
    pullRequestContexts: [],
    skills: [],
    mentions: [],
    selectedProvider: input.modelSelection.provider,
    selectedModel: input.modelSelection.model,
    selectedPromptEffort: input.selectedPromptEffort,
    modelSelection: input.modelSelection,
    ...(input.providerOptionsForDispatch
      ? { providerOptionsForDispatch: input.providerOptionsForDispatch }
      : {}),
    runtimeMode: input.runtimeMode,

    envMode: input.envMode,
  });
}
