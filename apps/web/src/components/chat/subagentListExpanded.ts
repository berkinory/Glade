import * as Schema from "effect/Schema";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const SUBAGENT_LIST_EXPANDED_KEY = "glade:subagent-list-expanded";

// One preference for every subagent roster: collapsed shows avatars and counts, expanded the rows.
export function useSubagentListExpanded() {
  return useLocalStorage(SUBAGENT_LIST_EXPANDED_KEY, false, Schema.Boolean);
}
