import { CommandId, EventId } from "@glade/contracts/core/baseSchemas";
import { Cause, Clock, Duration, Effect, Layer, Schedule, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  type IdleTurn,
  makeTurnIdleTracker,
  resolveTurnIdleTimeoutMs,
} from "../core/turnIdleTimeout.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import {
  ProviderTurnWatchdog,
  type ProviderTurnWatchdogShape,
} from "../Services/ProviderTurnWatchdog.ts";

const CHECK_INTERVAL_MS = 15_000;

function describeSilence(idleTimeoutMs: number): string {
  const minutes = Math.round(idleTimeoutMs / 60_000);
  if (minutes >= 1) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const seconds = Math.max(1, Math.round(idleTimeoutMs / 1000));
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

export const ProviderTurnWatchdogLive = Layer.effect(
  ProviderTurnWatchdog,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const providerService = yield* ProviderService;
    const idleTimeoutMs = resolveTurnIdleTimeoutMs();
    const tracker = makeTurnIdleTracker();
    const message = `The agent sent nothing for ${describeSilence(idleTimeoutMs)} with no tool running and no decision pending, so Glade stopped the turn.`;

    // Uses the same interrupt command as the Stop button, so a provider that ignores the native
    // interrupt is still settled by its bounded escalation to a session stop.
    const stopIdleTurn = (idle: IdleTurn, nowMs: number) =>
      Effect.gen(function* () {
        const session = (yield* providerService.listSessions()).find(
          (candidate) => candidate.threadId === idle.threadId,
        );
        // Only the turn the live provider still runs may be stopped; anything else already settled
        // or was replaced by a newer turn.
        if (session?.activeTurnId !== idle.turnId) {
          tracker.forget(idle);
          return;
        }
        if (yield* providerService.hasLiveRuntimeTasks({ threadId: idle.threadId })) {
          tracker.touch(idle, nowMs);
          return;
        }
        if (!tracker.isCurrent(idle)) return;
        // Disarm before dispatching so a slow interrupt cannot fire a second stop.
        tracker.forget(idle);
        const createdAt = new Date(nowMs).toISOString();
        const key = `provider-turn-idle:${idle.threadId}:${idle.turnId}`;
        yield* Effect.logWarning("provider.turn_idle_watchdog.stopping_turn", {
          threadId: idle.threadId,
          turnId: idle.turnId,
          provider: session.provider,
          idleTimeoutMs,
        });
        yield* engine.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(`${key}:activity`),
          threadId: idle.threadId,
          activity: {
            id: EventId.makeUnsafe(`${key}:activity`),
            tone: "info",
            kind: "runtime.warning",
            summary: "Agent stopped responding",
            payload: { message, detail: message, provider: session.provider },
            turnId: idle.turnId,
            createdAt,
          },
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.makeUnsafe(`${key}:interrupt`),
          threadId: idle.threadId,
          turnId: idle.turnId,
          createdAt,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider.turn_idle_watchdog.stop_failed", {
            threadId: idle.threadId,
            turnId: idle.turnId,
            cause: Cause.pretty(cause),
          }),
        ),
      );

    // A check long past its interval means the host slept or the process was suspended. That
    // silence is not the agent's, so every turn's window restarts.
    let lastCheckMs: number | null = null;
    const checkIdleTurns = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const suspended = lastCheckMs !== null && nowMs - lastCheckMs > 2 * CHECK_INTERVAL_MS;
      lastCheckMs = nowMs;
      if (suspended) {
        tracker.touchAll(nowMs);
        return;
      }
      yield* Effect.forEach(
        tracker.idleTurns(nowMs, idleTimeoutMs),
        (idle) => stopIdleTurn(idle, nowMs),
        { discard: true },
      );
    });

    const start: ProviderTurnWatchdogShape["start"] = () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Stream.runForEach(providerService.streamEvents, (event) =>
            Clock.currentTimeMillis.pipe(Effect.map((nowMs) => tracker.observe(event, nowMs))),
          ),
          { startImmediately: true },
        );
        yield* Effect.forkScoped(
          checkIdleTurns.pipe(Effect.repeat(Schedule.spaced(Duration.millis(CHECK_INTERVAL_MS)))),
        );
      });

    return { start } satisfies ProviderTurnWatchdogShape;
  }),
);
