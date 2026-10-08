import {
  THREAD_MESSAGE_SEARCH_MAX_QUERY_LENGTH,
  THREAD_MESSAGE_SEARCH_MIN_QUERY_LENGTH,
  type OrchestrationThreadMessageSearchMatch,
} from "@glade/contracts/orchestration/rpc";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import { EXPENSIVE_READ_RETRY_OPTIONS } from "./expensiveReadRetry";

const THREAD_MESSAGE_SEARCH_LIMIT = 24;
const THREAD_MESSAGE_SEARCH_STALE_TIME_MS = 10_000;

export interface ThreadMessageSearchResult {
  readonly query: string;
  readonly matches: readonly OrchestrationThreadMessageSearchMatch[];
}

export function threadMessageSearchQueryOptions(input: {
  readonly query: string;
  readonly enabled: boolean;
}) {
  const query = input.query.trim();
  return queryOptions({
    queryKey: ["orchestration", "search-thread-messages", query] as const,
    queryFn: async ({ signal }): Promise<ThreadMessageSearchResult> => {
      const result = await ensureNativeApi().orchestration.searchThreadMessages(
        { query, limit: THREAD_MESSAGE_SEARCH_LIMIT },
        { signal },
      );
      return { query, matches: result.matches };
    },
    enabled:
      input.enabled &&
      query.length >= THREAD_MESSAGE_SEARCH_MIN_QUERY_LENGTH &&
      query.length <= THREAD_MESSAGE_SEARCH_MAX_QUERY_LENGTH,
    staleTime: THREAD_MESSAGE_SEARCH_STALE_TIME_MS,
    // The previous response stays visible while the next query loads; the palette keeps only the
    // hits whose excerpt still matches what is typed now.
    placeholderData: (previous) => previous,
    ...EXPENSIVE_READ_RETRY_OPTIONS,
  });
}
