import {
  EventId,
  type MessageId,
  type ThreadId,
  type TurnId,
} from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore";
import { OrchestrationProjectionPipeline } from "./Services/ProjectionPipeline";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine";

export function seedUserMessage(input: {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly createdAt: string;
  readonly turnId?: TurnId;
}) {
  return Effect.gen(function* () {
    const events = yield* OrchestrationEventStore;
    const pipeline = yield* OrchestrationProjectionPipeline;
    const engine = yield* OrchestrationEngineService;
    const event = yield* events.append({
      metadata: {},
      eventId: EventId.makeUnsafe(`seed:${input.messageId}`),
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.createdAt,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      type: "thread.message-sent",
      payload: {
        ...input,
        role: "user",
        turnId: input.turnId ?? null,
        streaming: false,
        source: "native",
        updatedAt: input.createdAt,
      },
    });
    yield* pipeline.projectEvent(event);
    yield* engine.refreshCommandReadModel();
  });
}
