import type { ChatViewProps } from "./chatViewSupport";
import { useChatActionsController } from "./useChatActionsController";
import { useChatComposerController } from "./useChatComposerController";
import { useChatDiscoveryController } from "./useChatDiscoveryController";
import { useChatEnvironmentController } from "./useChatEnvironmentController";
import { useChatProviderController } from "./useChatProviderController";
import { useChatSessionController } from "./useChatSessionController";
import { useChatSubmissionController } from "./useChatSubmissionController";
import { useChatSurfaceController } from "./useChatSurfaceController";
import { useChatTranscriptController } from "./useChatTranscriptController";
import { useChatWorkspaceController } from "./useChatWorkspaceController";
export function useChatController(props: ChatViewProps) {
  const session = useChatSessionController(props);
  const workspace = useChatWorkspaceController({ props, session });
  const provider = useChatProviderController({ props, session, workspace });
  const transcript = useChatTranscriptController({ provider, workspace, session, props });
  const discovery = useChatDiscoveryController({ transcript, workspace, session, provider, props });
  const composer = useChatComposerController({
    session,
    props,
    discovery,
    transcript,
    workspace,
    provider,
  });
  const environment = useChatEnvironmentController({
    props,
    session,
    discovery,
    transcript,
    workspace,
    composer,
    provider,
  });
  const actions = useChatActionsController({
    session,
    provider,
    workspace,
    discovery,
    transcript,
    environment,
    composer,
    props,
  });
  const submission = useChatSubmissionController({
    props,
    session,
    provider,
    composer,
    workspace,
    environment,
    actions,
    transcript,
    discovery,
  });
  const surface = useChatSurfaceController({
    session,
    workspace,
    props,
    discovery,
    environment,
    composer,
    submission,
    provider,
  });
  return {
    props,
    session,
    workspace,
    provider,
    transcript,
    discovery,
    composer,
    environment,
    actions,
    submission,
    surface,
  };
}
export type ChatController = ReturnType<typeof useChatController>;
