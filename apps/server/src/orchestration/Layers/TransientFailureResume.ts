import { ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Clock, Effect, FiberMap, Layer, Stream, SubscriptionRef } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { isResumableThread, sleepUntil } from "../agentResume.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  TransientFailureResume,
  type TransientFailureResumeShape,
} from "../Services/TransientFailureResume.ts";
import {
  isTransientFailure,
  nextTransientFailureResume,
  transientFailureResumeActivityCommand,
  transientFailureResumeTurnCommand,
} from "../transientFailureResume.ts";

// A resume due while the host slept would continue a chat long after the user last saw it.
const LATE_RESUME_LIMIT_MS = 10 * 60_000;

// The user taking over a chat ends its wait.
const USER_TAKEOVER_EVENTS: ReadonlySet<OrchestrationEvent["type"]> = new Set([
  "thread.turn-start-requested",
  "thread.turn-queued",
  "thread.turn-interrupt-requested",
  "thread.session-stop-requested",
  "thread.archived",
  "thread.deleted",
]);

interface TransientFailureWait {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly dueMs: number;
  readonly scheduledAt: string;
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  // The turn each live wait belongs to.
  const waitingTurns = yield* SubscriptionRef.make<ReadonlyMap<ThreadId, TurnId>>(new Map());

  const readThread = (threadId: ThreadId) =>
    engine
      .getReadModel()
      .pipe(Effect.map((model) => model.threads.find((thread) => thread.id === threadId)));

  const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

  const releaseWait = (wait: Pick<TransientFailureWait, "threadId" | "turnId">) =>
    SubscriptionRef.update(waitingTurns, (current) => {
      if (current.get(wait.threadId) !== wait.turnId) return current;
      const next = new Map(current);
      next.delete(wait.threadId);
      return next;
    });

  const waitThenResume = (wait: TransientFailureWait): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* sleepUntil(wait.dueMs);
      if ((yield* Clock.currentTimeMillis) > wait.dueMs + LATE_RESUME_LIMIT_MS) {
        yield* Effect.logInfo("transient-failure resume came due while the host was away", {
          threadId: wait.threadId,
        });
        return;
      }
      const thread = yield* readThread(wait.threadId);
      if (
        !thread ||
        !isResumableThread(thread) ||
        thread.latestTurn?.turnId !== wait.turnId ||
        thread.latestTurn.state !== "error"
      ) {
        return;
      }
      // Released first, so the turn this dispatch starts does not read as the user taking over.
      yield* releaseWait(wait);
      yield* engine
        .dispatch(
          transientFailureResumeTurnCommand({
            thread,
            turnId: wait.turnId,
            scheduledAt: wait.scheduledAt,
            now: yield* nowIso,
          }),
        )
        .pipe(
          Effect.tap(() =>
            Effect.logInfo("continued a chat after a temporary provider error", {
              threadId: wait.threadId,
            }),
          ),
          Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
            Effect.logInfo("transient-failure resume was not accepted", {
              threadId: wait.threadId,
              detail: error.detail,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("transient-failure resume failed to dispatch", {
              threadId: wait.threadId,
              cause,
            }),
          ),
        );
    });

  const start: TransientFailureResumeShape["start"] = Effect.fn(function* () {
    const waits = yield* FiberMap.make<ThreadId>();

    const startWait = (wait: TransientFailureWait) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(waitingTurns, (current) =>
          new Map(current).set(wait.threadId, wait.turnId),
        );
        yield* FiberMap.run(
          waits,
          wait.threadId,
          waitThenResume(wait).pipe(Effect.ensuring(releaseWait(wait))),
        );
      });

    const arm = (event: Extract<ProviderRuntimeEvent, { type: "runtime.error" }>) =>
      Effect.gen(function* () {
        const thread = yield* readThread(event.threadId);
        if (!thread || !isResumableThread(thread)) return;
        const turnId = event.turnId ?? thread.latestTurn?.turnId;
        if (!turnId || (yield* SubscriptionRef.get(waitingTurns)).get(thread.id) === turnId) return;
        const resume = nextTransientFailureResume(thread.messages);
        if (resume === null) {
          yield* Effect.logInfo("temporary provider errors outlasted automatic resumes", {
            threadId: thread.id,
          });
          return;
        }
        const nowMs = yield* Clock.currentTimeMillis;
        const now = new Date(nowMs).toISOString();
        yield* engine
          .dispatch(
            transientFailureResumeActivityCommand({ threadId: thread.id, turnId, resume, now }),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("transient-failure resume could not record its wait", {
                threadId: thread.id,
                cause,
              }),
            ),
          );
        yield* startWait({
          threadId: thread.id,
          turnId,
          dueMs: nowMs + resume.delayMs,
          scheduledAt: now,
        });
      });

    const onRuntimeEvent = (event: ProviderRuntimeEvent) =>
      event.type === "runtime.error" && isTransientFailure(event.payload.failure)
        ? arm(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("transient-failure resume could not arm", {
                threadId: event.threadId,
                cause,
              }),
            ),
          )
        : Effect.void;

    const onDomainEvent = (event: OrchestrationEvent) =>
      Effect.gen(function* () {
        if (event.aggregateKind !== "thread" || !USER_TAKEOVER_EVENTS.has(event.type)) return;
        const threadId = ThreadId.makeUnsafe(String(event.aggregateId));
        if (!(yield* SubscriptionRef.get(waitingTurns)).has(threadId)) return;
        yield* FiberMap.remove(waits, threadId);
      });

    const domainEvents = yield* engine.subscribeDomainEvents;
    yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, onRuntimeEvent), {
      startImmediately: true,
    });
    yield* Effect.forkScoped(Stream.runForEach(domainEvents, onDomainEvent), {
      startImmediately: true,
    });
  });

  return {
    start,
    streamWaiting: SubscriptionRef.changes(waitingTurns).pipe(
      Stream.map((turns) => turns.size > 0),
      Stream.changes,
    ),
  } satisfies TransientFailureResumeShape;
});

export const TransientFailureResumeLive = Layer.effect(TransientFailureResume, make);
