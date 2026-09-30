import type { ChatViewProps } from "./chat/controller/chatViewSupport";
import { useChatController } from "./chat/controller/useChatController";
import { ChatControllerSurface } from "./chat/controller/ChatControllerSurface";

export default function ChatView(props: ChatViewProps) {
  const controller = useChatController(props);
  return <ChatControllerSurface controller={controller} />;
}
