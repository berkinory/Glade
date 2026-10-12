import { Effect, FileSystem } from "effect";
import type { EventId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { readClaudeMonitorEvents } from "../claudeMonitorEvents.ts";
import { asCanonicalTurnId, nativeProviderRefs } from "./messageContent";
import { type ClaudeSessionContext, PROVIDER } from "./sessionTypes";

export function makeClaudeMonitorEvents(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
}) {
  const { fileSystem, makeEventStamp, offerRuntimeEvent } = input;

  // Emits the Monitor events that woke the agent into the current turn. Runs inline before the
  // turn's reply is handled, so the rows never land inside the reply they prompted.
  const emitMonitorEvents = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const cursor = context.monitorEventCursor;
      const sessionId = context.resumeSessionId;
      if (!cursor || !context.turnState || !sessionId) return;
      const turnId = asCanonicalTurnId(context.turnState.turnId);
      const events = yield* readClaudeMonitorEvents(fileSystem, cursor, {
        sessionId,
        configDir: context.claudeConfigDir,
        notBefore: context.startedAt,
      });
      for (const event of events) {
        if (context.stopped) return;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "runtime.warning",
          eventId: stamp.eventId,
          provider: PROVIDER,
          // The notification time places the row above the reply it prompted.
          createdAt: event.createdAt,
          threadId: context.session.threadId,
          turnId,
          payload: {
            message: event.name ? `${event.name}: ${event.output}` : event.output,
            detail: {
              type: "system",
              subtype: "monitor_event",
              task_id: event.taskId,
              name: event.name,
              output: event.output,
              outcome: event.outcome,
            },
          },
          providerRefs: nativeProviderRefs(context),
        });
      }
    });

  return { emitMonitorEvents };
}
