import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { createContext, useContext, type ReactNode } from "react";

interface ChatThreadContextValue {
  threadId: ThreadId;
  projectId: ProjectId | null;
}

const ChatThreadContext = createContext<ChatThreadContextValue | null>(null);

export function ChatThreadProvider({
  value,
  children,
}: {
  value: ChatThreadContextValue;
  children: ReactNode;
}) {
  return <ChatThreadContext.Provider value={value}>{children}</ChatThreadContext.Provider>;
}

/** The open chat's id, or null where a row renders outside a chat (a card, a preview). */
export function useOptionalChatThreadId(): ThreadId | null {
  return useContext(ChatThreadContext)?.threadId ?? null;
}

export function useChatThreadContext(): ChatThreadContextValue {
  const context = useContext(ChatThreadContext);
  if (!context) throw new Error("ChatThreadProvider is required");
  return context;
}
