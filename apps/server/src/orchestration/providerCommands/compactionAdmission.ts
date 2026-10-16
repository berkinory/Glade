import { Effect, Stream, Schema } from "effect";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine";
import type { ProviderIntentEvent } from "../providerIntentClassification";
import { CompactionAdmission } from "../../provider/Services/CompactionAdmission";
import { ProviderAdapterValidationError } from "../../provider/core/Errors";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

const CANCELLING_EVENTS = [
  "thread.session-stop-requested",
  "thread.turn-interrupt-requested",
  "thread.archived",
  "thread.deleted",
  "thread.message-edit-resend-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
];

export function withCompactionAdmission<A, E, R>(
  engine: Pick<OrchestrationEngineShape, "getEventHighWaterSequence" | "readThreadEventsThrough">,
  event: ProviderIntentEvent,
  provider: ProviderKind,
  work: Effect.Effect<A, E, R>,
) {
  return Effect.suspend(() => {
    let admitted = false;
    const check = Effect.gen(function* () {
      if (admitted) return;
      const through = yield* engine.getEventHighWaterSequence;
      const cancelled = yield* engine
        .readThreadEventsThrough(event.payload.threadId, event.sequence, through, CANCELLING_EVENTS)
        .pipe(
          Stream.runFold(
            () => false,
            () => true,
          ),
        );
      if (cancelled && !admitted)
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "startCompaction",
          issue: "Compaction was cancelled before native delivery.",
        });
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ProviderAdapterValidationError)(cause)
          ? cause
          : new ProviderAdapterValidationError({
              provider,
              operation: "startCompaction",
              issue: "Could not verify compaction admission. Try again.",
              cause,
            }),
      ),
    );
    // Observe durable cancellation outside the ordered provider consumer. Native teardown
    // still runs in that consumer after this preparation yields ownership.
    const cancellation = Effect.gen(function* () {
      while (true) {
        yield* check;
        yield* Effect.sleep(100);
      }
    });
    return Effect.raceFirst(
      check.pipe(
        Effect.andThen(work),
        Effect.provideService(CompactionAdmission, {
          check,
          admitted: () => {
            admitted = true;
          },
        }),
      ),
      cancellation,
    );
  });
}
