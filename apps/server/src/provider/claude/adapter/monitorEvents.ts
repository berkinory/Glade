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

  // Emits the Monitor events read since the last read into the current turn: the ones that woke the
  // agent, inline before the turn's reply is handled so they never land inside the reply they
  // prompted, and the ones that arrived while the turn worked.
  const emitMonitorEvents = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const cursor = context.monitorEventCursor;
      const sessionId = context.resumeSessionId;
      if (!cursor || !context.turnState || !sessionId) return;
      const turnId = asCanonicalTurnId(context.turnState.turnId);
      const turnStartedAtMs = Date.parse(context.turnState.startedAt);
      const events = yield* readClaudeMonitorEvents(fileSystem, cursor, {
        sessionId,
        configDir: context.claudeConfigDir,
        notBefore: context.startedAt,
      });
      for (const event of events) {
        if (context.stopped) return;
        // The CLI writes the notification that wakes the agent before that turn starts. One written
        // after the turn started arrived while the agent was working and is an update inside the turn.
        const midTurn = Date.parse(event.createdAt) >= turnStartedAtMs;
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
              ...(midTurn ? { mid_turn: true } : {}),
            },
          },
          providerRefs: nativeProviderRefs(context),
        });
      }
    });

  return { emitMonitorEvents };
}
