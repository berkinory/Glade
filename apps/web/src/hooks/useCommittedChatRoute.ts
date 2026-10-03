import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useRouterState } from "@tanstack/react-router";

export function useCommittedChatRoute() {
  // Loaded matches own params, pathname and search together, including during a pending navigation.
  const match = useRouterState({ select: (state) => state.matches.at(-1) });
  const params = match?.params;
  return {
    pathname: match?.pathname ?? "/",
    threadId: params && "threadId" in params ? ThreadId.makeUnsafe(params.threadId) : null,
    search: (match?.search ?? {}) as Record<string, unknown>,
  };
}
