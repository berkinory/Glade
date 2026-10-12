import { EventId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import type {
  OrchestrationThreadActivity,
  ThreadHandoff,
} from "@glade/contracts/orchestration/threadEntities";

// One activity per transition, rewritten in place on every stage change through its stable id.
export function handoffTransitionActivity(handoff: ThreadHandoff): OrchestrationThreadActivity {
  const source = handoff.sourceModelSelection;
  const destination = handoff.destinationModelSelection;
  return {
    id: EventId.makeUnsafe(`handoff-transition:${handoff.operationId}`),
    kind: "provider.transition",
    tone: handoff.stage === "uncertain" ? "error" : "info",
    summary: `${PROVIDER_DISPLAY_NAMES[source.provider]} · ${source.model} → ${PROVIDER_DISPLAY_NAMES[destination.provider]} · ${destination.model}: ${handoff.stage}`,
    payload: {
      operationId: handoff.operationId,
      source: { provider: source.provider },
      destination: { provider: destination.provider },
      stage: handoff.stage,
      ...(handoff.strategy ? { strategy: handoff.strategy } : {}),
      detail: JSON.stringify(
        {
          source,
          destination,
          stage: handoff.stage,
          strategy: handoff.strategy,
          channel: handoff.channel,
          selectedItems: handoff.selectedItems,
          omittedItems: handoff.omittedItems,
          context: handoff.transferredContext,
          failure: handoff.detail,
        },
        null,
        2,
      ),
    },
    turnId: null,
    createdAt: handoff.createdAt,
  };
}
