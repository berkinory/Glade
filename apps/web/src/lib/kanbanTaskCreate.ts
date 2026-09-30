import type {
  AssistantDeliveryMode,
  ModelSelection,
  ProviderInteractionMode,
  ProviderStartOptions,
  RuntimeMode,
} from "@glade/contracts/orchestration/orchestration";
import type { ProjectId, ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";

import { useComposerDraftStore, type DraftThreadEnvMode } from "../composerDraftStore";
import { dispatchKanbanDraftThread, type KanbanDraftDispatchResult } from "./kanbanDispatch";
import { newThreadId } from "./utils";

export interface KanbanDraftTaskInput {
  projectId: ProjectId;
  prompt: string;

  sourceComposerThreadId?: ThreadId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
}

export function createKanbanDraftTask(input: KanbanDraftTaskInput): ThreadId {
  const store = useComposerDraftStore.getState();
  const threadId = newThreadId();
  store.registerDraftThread(threadId, {
    projectId: input.projectId,
    envMode: input.envMode,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  });
  if (input.sourceComposerThreadId) {
    store.copyTransferableComposerState(input.sourceComposerThreadId, threadId);
  } else {
    store.setPrompt(threadId, input.prompt);
  }
  store.setModelSelection(threadId, input.modelSelection);
  store.setRuntimeMode(threadId, input.runtimeMode);
  store.setInteractionMode(threadId, input.interactionMode);
  return threadId;
}

export async function createAndSendKanbanTask(
  input: KanbanDraftTaskInput & {
    defaultProvider: ProviderKind;
    assistantDeliveryMode: AssistantDeliveryMode;
    providerOptions?: ProviderStartOptions | undefined;
  },
): Promise<{ threadId: ThreadId; result: KanbanDraftDispatchResult }> {
  const threadId = createKanbanDraftTask(input);
  const result = await dispatchKanbanDraftThread({
    threadId,
    projectId: input.projectId,
    thread: null,
    defaultProvider: input.defaultProvider,
    assistantDeliveryMode: input.assistantDeliveryMode,
    providerOptions: input.providerOptions,
  });
  return { threadId, result };
}
