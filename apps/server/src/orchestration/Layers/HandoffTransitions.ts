import { CommandId } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer, Option, Schema } from "effect";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { ProviderValidationError } from "../../provider/core/Errors";
import { handoffTransitionActivity } from "../handoff/transitionActivity";

export const HandoffTransitionsLive = Layer.effect(
  HandoffTransitions,
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const invalid = (issue: string) =>
      new ProviderValidationError({ operation: "handoff.transition", issue });
    return {
      update: (threadId, operationId, patch) =>
        Effect.gen(function* () {
          const thread = Option.getOrUndefined(yield* query.getThreadShellById(threadId));
          if (
            !thread ||
            thread.archivedAt != null ||
            thread.handoff?.operationId !== operationId ||
            thread.handoff.stage === "cancelled"
          )
            return yield* invalid("The provider transition is unavailable or was cancelled.");
          const handoff = { ...thread.handoff, ...patch };
          yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe(`server:handoff:stage:${crypto.randomUUID()}`),
            threadId,
            expectedHandoffOperationId: operationId,
            handoff,
          });
          yield* engine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.makeUnsafe(`server:handoff:transition:${crypto.randomUUID()}`),
            threadId,
            activity: handoffTransitionActivity(handoff),
            createdAt: new Date().toISOString(),
          });
          return handoff;
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ProviderValidationError)(cause)
              ? cause
              : invalid("Could not save the provider transition."),
          ),
        ),
    };
  }),
);
