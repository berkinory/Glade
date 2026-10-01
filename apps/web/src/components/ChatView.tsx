import type { ChatViewProps } from "./chat/controller/chatViewSupport";
import { useChatController } from "./chat/controller/useChatController";
import { ChatControllerSurface } from "./chat/controller/ChatControllerSurface";
import { ChatThreadProvider } from "./chat/ChatThreadContext";
import { useStore } from "~/store";
import { createThreadProjectIdSelector } from "~/storeSelectors";
import { useMemo } from "react";

export default function ChatView(props: ChatViewProps) {
  const projectIdSelector = useMemo(
    () => createThreadProjectIdSelector(props.threadId),
    [props.threadId],
  );
  const projectId = useStore(projectIdSelector);
  const context = useMemo(
    () => ({ threadId: props.threadId, projectId, surfaceMode: props.surfaceMode ?? "single" }),
    [props.threadId, projectId, props.surfaceMode],
  );
  return (
    <ChatThreadProvider value={context}>
      <ChatViewContent {...props} />
    </ChatThreadProvider>
  );
}

function ChatViewContent(props: ChatViewProps) {
  const controller = useChatController(props);
  return <ChatControllerSurface controller={controller} />;
}
