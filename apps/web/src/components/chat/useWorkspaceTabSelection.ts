import { useEffect, useEffectEvent, useState } from "react";

export function useWorkspaceTabSelection(input: {
  tabIds: string[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [history, setHistory] = useState<{ recentIds: string[]; openIds: string[] }>({
    recentIds: [],
    openIds: [],
  });
  const tabIdsKey = JSON.stringify(input.tabIds);
  const activeExists = input.tabIds.includes(input.activeId);
  const previousWasClosed =
    Boolean(history.recentIds[0]) && !input.tabIds.includes(history.recentIds[0]!);
  const activeWasOpened = activeExists && !history.openIds.includes(input.activeId);
  const fallback =
    history.recentIds.find((id) => input.tabIds.includes(id)) ??
    history.openIds.findLast((id) => id !== "chat" && input.tabIds.includes(id)) ??
    input.tabIds.find((id) => id !== "chat") ??
    input.tabIds[0] ??
    "chat";
  const resolvedId =
    activeExists && (!previousWasClosed || activeWasOpened) ? input.activeId : fallback;
  const synchronize = useEffectEvent(() => {
    if (resolvedId !== input.activeId) {
      input.onSelect(resolvedId);
      return;
    }
    setHistory((current) => {
      if (current.recentIds[0] === resolvedId && JSON.stringify(current.openIds) === tabIdsKey)
        return current;
      return {
        openIds: input.tabIds,
        recentIds: [
          resolvedId,
          ...current.recentIds.filter((id) => id !== resolvedId && input.tabIds.includes(id)),
        ],
      };
    });
  });
  useEffect(() => synchronize(), [resolvedId, input.activeId, tabIdsKey]);
  return resolvedId;
}
