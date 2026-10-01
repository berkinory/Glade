import { Effect, Option, Stream } from "effect";
import type { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";

export const readThreadTitleIntent = (
  engine: Pick<
    OrchestrationEngineShape,
    "getThreadTitleHighWaterSequence" | "readThreadEventsThrough"
  >,
  threadId: ThreadId,
) =>
  Effect.gen(function* () {
    const sequence = yield* engine.getThreadTitleHighWaterSequence(threadId);
    const latest =
      sequence > 0
        ? yield* Stream.runHead(engine.readThreadEventsThrough(threadId, sequence - 1, sequence))
        : Option.none();
    const event = Option.getOrUndefined(latest);
    return {
      sequence,
      userTitle:
        event?.type === "thread.meta-updated" && event.payload.titleSource === "user"
          ? event.payload.title
          : undefined,
    };
  });

export const applyNativeThreadTitle = (input: {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly commandId: CommandId;
  readonly engine: Pick<
    OrchestrationEngineShape,
    "getThreadTitleHighWaterSequence" | "readThreadEventsThrough" | "dispatch"
  >;
  readonly provider: Pick<ProviderServiceShape, "updateNativeHistory">;
}) =>
  Effect.gen(function* () {
    const { sequence, userTitle } = yield* readThreadTitleIntent(input.engine, input.threadId);
    if (userTitle !== undefined && userTitle !== input.title) {
      // A rename can precede native history creation. Preserve the durable user intent until the
      // provider has a session to rename instead of replacing it with its first generated title.
      yield* input.provider.updateNativeHistory({
        threadId: input.threadId,
        action: { type: "rename", title: userTitle },
      });
      return;
    }
    yield* input.engine
      .dispatch({
        type: "thread.meta.update",
        commandId: input.commandId,
        threadId: input.threadId,
        title: input.title,
        titleSource: "provider",
        expectedTitleSequence: sequence,
      })
      .pipe(Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void));
  });
