import * as Schema from "effect/Schema";
import { useLocalStorage } from "~/hooks/useLocalStorage";

export type EnvironmentListSection = "subagents" | "background-tasks";

const OPEN_LISTS_KEY = "glade:environment-open-lists";
// Only open lists are stored, newest last; the oldest are forgotten past this many.
const MAX_REMEMBERED_OPEN_LISTS = 200;
const OpenLists = Schema.Array(Schema.String);
const NO_OPEN_LISTS: readonly string[] = [];

/**
 * Whether one of the Environment panel's lists is open for a chat. Lists start closed, and each chat
 * remembers its own choice.
 */
export function useEnvironmentListOpen(
  section: EnvironmentListSection,
  chatId: string | null,
): [boolean, (open: boolean) => void] {
  const [openLists, setOpenLists] = useLocalStorage(OPEN_LISTS_KEY, NO_OPEN_LISTS, OpenLists);
  const listKey = chatId ? `${section}:${chatId}` : null;
  const setOpen = (open: boolean) => {
    if (!listKey) return;
    setOpenLists((current) => {
      const others = current.filter((key) => key !== listKey);
      return open ? [...others, listKey].slice(-MAX_REMEMBERED_OPEN_LISTS) : others;
    });
  };
  return [listKey !== null && openLists.includes(listKey), setOpen];
}
