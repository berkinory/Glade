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
    readonly abort: (
      threadId: ThreadId,
      operationId: CommandId,
    ) => Effect.Effect<void, ProviderValidationError>;
    readonly validate: (
      threadId: ThreadId,
      operationId: CommandId,
    ) => Effect.Effect<ThreadHandoff, ProviderValidationError>;
    readonly update: (
      threadId: ThreadId,
      operationId: CommandId,
      patch: Partial<ThreadHandoff> & { stage: HandoffTransitionStage },
    ) => Effect.Effect<void, ProviderValidationError>;
  }
>()("glade/orchestration/Services/HandoffTransitions") {}
