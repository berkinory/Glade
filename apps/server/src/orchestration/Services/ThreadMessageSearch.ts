import type {
  OrchestrationSearchThreadMessagesInput,
  OrchestrationSearchThreadMessagesResult,
} from "@glade/contracts/orchestration/rpc";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError } from "../../persistence/Errors.ts";

export interface ThreadMessageSearchShape {
  readonly search: (
    input: OrchestrationSearchThreadMessagesInput,
  ) => Effect.Effect<OrchestrationSearchThreadMessagesResult, PersistenceSqlError>;
}

export class ThreadMessageSearch extends ServiceMap.Service<
  ThreadMessageSearch,
  ThreadMessageSearchShape
>()("glade/orchestration/ThreadMessageSearch") {}
