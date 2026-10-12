import type { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  HandoffTransitionStage,
  ThreadHandoff,
} from "@glade/contracts/orchestration/threadEntities";
import { ServiceMap, type Effect } from "effect";
import type { ProviderValidationError } from "../../provider/core/Errors";

export class HandoffTransitions extends ServiceMap.Service<
  HandoffTransitions,
  {
    readonly update: (
      threadId: ThreadId,
      operationId: CommandId,
      patch: Partial<Omit<ThreadHandoff, "operationId">> & { stage: HandoffTransitionStage },
    ) => Effect.Effect<ThreadHandoff, ProviderValidationError>;
  }
>()("glade/orchestration/Services/HandoffTransitions") {}
