import type { ProviderKind, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import {
  USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/usageLimitResume";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import {
  pendingUsageLimitResume,
  USAGE_LIMIT_RESUME_GRACE_MS,
} from "@glade/shared/threads/usageLimitResume";
import { Clock, Duration, Effect, FiberMap, Layer, Stream } from "effect";

import {
  ProjectionThreadActivityRepository,
  type ProjectionThreadActivity,
} from "../../persistence/Services/ProjectionThreadActivities.ts";
import { listProviderUsage } from "../../provider/usage/index.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../server/config.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { UsageLimitResume, type UsageLimitResumeShape } from "../Services/UsageLimitResume.ts";
import {
  exhaustedUsageResetsAt,
  isUsageLimitFailure,
  USAGE_LIMIT_RESUME_MAX_WAIT_MS,
  usageLimitResumeActivityCommand,
  usageLimitResumeChainExhausted,
  usageLimitResumeTurnCommand,
} from "../usageLimitResume.ts";

// Reset times are minute-granular and clocks drift; continuing a little late avoids a rejection.
const RESUME_DELAY_MS = 30_000;
// Node timers pause while the host sleeps, so waits re-read the wall clock at least this often.
const WALL_CLOCK_CHECK_MS = 60_000;

interface UsageLimitWait {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly provider: ProviderKind;
  readonly resetsAt: string;
  readonly scheduledAt: string;
}

const isResumableThread = (thread: OrchestrationThread): boolean =>
  thread.deletedAt === null && thread.archivedAt == null && thread.parentThreadId === null;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const serverSettings = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const activityRepository = yield* ProjectionThreadActivityRepository;

  const autoContinueEnabled = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.autoContinueAtUsageLimit),
    Effect.catch((error) =>
      Effect.logWarning("usage-limit resume could not read settings", {
        detail: error.detail,
      }).pipe(Effect.as(false)),
    ),
  );

  const readThread = (threadId: ThreadId) =>
    engine
      .getReadModel()
      .pipe(Effect.map((model) => model.threads.find((thread) => thread.id === threadId)));

  const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

  // A failed probe leaves the provider-reported reset as the only evidence, so it reads as unknown.
  const exhaustedResetsAt = (provider: ProviderKind) =>
    listProviderUsage({ provider, forceRefresh: true }).pipe(
      Effect.provideService(ServerConfig, serverConfig),
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.flatMap((snapshots) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((nowMs) => exhaustedUsageResetsAt(snapshots, nowMs)),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("usage-limit resume could not read provider usage", {
          provider,
          cause,
        }).pipe(Effect.as(null)),
      ),
    );

  const recordActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly resetsAt: string | null;
  }) =>
    nowIso.pipe(
      Effect.flatMap((now) => engine.dispatch(usageLimitResumeActivityCommand({ ...input, now }))),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning("usage-limit resume could not record its state", {
          threadId: input.threadId,
          cause,
        }),
      ),
    );

  const sleepUntil = (targetMs: number) =>
    Effect.gen(function* () {
      for (;;) {
        const remainingMs = targetMs - (yield* Clock.currentTimeMillis);
        if (remainingMs <= 0) return;
        yield* Effect.sleep(Duration.millis(Math.min(remainingMs, WALL_CLOCK_CHECK_MS)));
      }
    });

  const waitThenResume = (wait: UsageLimitWait): Effect.Effect<void> =>
    Effect.gen(function* () {
      let resetsAt = wait.resetsAt;
      for (;;) {
        const resetMs = Date.parse(resetsAt);
        yield* sleepUntil(resetMs + RESUME_DELAY_MS);
        const nowMs = yield* Clock.currentTimeMillis;
        if (nowMs > resetMs + USAGE_LIMIT_RESUME_GRACE_MS) {
          yield* Effect.logInfo(
            "usage limit reset while the host was away; leaving it to the user",
            {
              threadId: wait.threadId,
              resetsAt,
            },
          );
          return;
        }
        if (!(yield* autoContinueEnabled)) return;
        const thread = yield* readThread(wait.threadId);
        if (
          !thread ||
          !isResumableThread(thread) ||
          thread.latestTurn?.turnId !== wait.turnId ||
          thread.latestTurn.state !== "error"
        ) {
          return;
        }
        const stillLimitedUntil = yield* exhaustedResetsAt(wait.provider);
        if (stillLimitedUntil !== null) {
          const tooFar = Date.parse(stillLimitedUntil) - nowMs > USAGE_LIMIT_RESUME_MAX_WAIT_MS;
          yield* recordActivity({
            threadId: wait.threadId,
            turnId: wait.turnId,
            resetsAt: tooFar ? null : stillLimitedUntil,
          });
          if (tooFar) return;
          resetsAt = stillLimitedUntil;
          continue;
        }
        const now = yield* nowIso;
        yield* engine
          .dispatch(
            usageLimitResumeTurnCommand({
              thread,
              turnId: wait.turnId,
              scheduledAt: wait.scheduledAt,
              now,
            }),
          )
          .pipe(
            Effect.tap(() =>
              Effect.logInfo("continued a chat after its usage limit reset", {
                threadId: wait.threadId,
              }),
            ),
            Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
              Effect.logInfo("usage-limit resume was not accepted", {
                threadId: wait.threadId,
                detail: error.detail,
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("usage-limit resume failed to dispatch", {
                threadId: wait.threadId,
                cause,
              }),
            ),
          );
        return;
      }
    });

  const start: UsageLimitResumeShape["start"] = Effect.fn(function* () {
    const waits = yield* FiberMap.make<ThreadId>();
    // The turn each live wait belongs to; a settings change must cancel exactly those.
    const waitingTurns = new Map<ThreadId, TurnId>();

    const startWait = (wait: UsageLimitWait) =>
      Effect.gen(function* () {
        waitingTurns.set(wait.threadId, wait.turnId);
        yield* FiberMap.run(
          waits,
          wait.threadId,
          waitThenResume(wait).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (waitingTurns.get(wait.threadId) === wait.turnId) {
                  waitingTurns.delete(wait.threadId);
                }
              }),
            ),
          ),
        );
      });

    const arm = (event: Extract<ProviderRuntimeEvent, { type: "runtime.error" }>) =>
      Effect.gen(function* () {
        if (!(yield* autoContinueEnabled)) return;
        const thread = yield* readThread(event.threadId);
        if (!thread || !isResumableThread(thread)) return;
        const turnId = event.turnId ?? thread.latestTurn?.turnId;
        if (!turnId || waitingTurns.get(thread.id) === turnId) return;
        if (usageLimitResumeChainExhausted(thread.messages)) {
          yield* Effect.logInfo(
            "usage limit hit again after automatic resumes; waiting for the user",
            {
              threadId: thread.id,
            },
          );
          return;
        }
        const reportedResetsAt =
          event.payload.failure?.resetsAt ?? (yield* exhaustedResetsAt(event.provider));
        const nowMs = yield* Clock.currentTimeMillis;
        const reportedResetMs = reportedResetsAt ? Date.parse(reportedResetsAt) : Number.NaN;
        if (
          Number.isNaN(reportedResetMs) ||
          reportedResetMs - nowMs > USAGE_LIMIT_RESUME_MAX_WAIT_MS
        ) {
          yield* Effect.logInfo("usage limit has no reset to wait for", {
            threadId: thread.id,
            resetsAt: reportedResetsAt,
          });
          return;
        }
        // A reset already behind us is stale; waiting from now lets the usage check decide.
        const resetsAt = new Date(Math.max(reportedResetMs, nowMs)).toISOString();
        const scheduledAt = new Date(nowMs).toISOString();
        yield* recordActivity({ threadId: thread.id, turnId, resetsAt });
        yield* startWait({
          threadId: thread.id,
          turnId,
          provider: event.provider,
          resetsAt,
          scheduledAt,
        });
      });

    const onRuntimeEvent = (event: ProviderRuntimeEvent) =>
      event.type === "runtime.error" && isUsageLimitFailure(event.payload.failure)
        ? arm(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("usage-limit resume could not arm", {
                threadId: event.threadId,
                cause,
              }),
            ),
          )
        : Effect.void;

    const onDomainEvent = (event: OrchestrationEvent) => {
      if (
        event.type !== "thread.activity-appended" ||
        event.payload.activity.kind !== USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND ||
        waitingTurns.get(event.payload.threadId) !== event.payload.activity.turnId
      ) {
        return Effect.void;
      }
      return FiberMap.remove(waits, event.payload.threadId);
    };

    const cancelAllWaits = Effect.gen(function* () {
      const cancelled = [...waitingTurns];
      yield* FiberMap.clear(waits);
      yield* Effect.forEach(
        cancelled,
        ([threadId, turnId]) => recordActivity({ threadId, turnId, resetsAt: null }),
        { discard: true },
      );
    });

    const recover = Effect.gen(function* () {
      if (!(yield* autoContinueEnabled)) return;
      const nowMs = yield* Clock.currentTimeMillis;
      const rows = yield* activityRepository.listByKinds({
        kinds: [
          USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
          USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
        ],
        createdSince: new Date(
          nowMs - USAGE_LIMIT_RESUME_MAX_WAIT_MS - USAGE_LIMIT_RESUME_GRACE_MS,
        ).toISOString(),
      });
      if (rows.length === 0) return;
      const rowsByThread = new Map<string, ProjectionThreadActivity[]>();
      for (const row of rows) {
        const threadRows = rowsByThread.get(row.threadId) ?? [];
        threadRows.push(row);
        rowsByThread.set(row.threadId, threadRows);
      }
      const model = yield* engine.getReadModel();
      for (const thread of model.threads) {
        const activities = rowsByThread.get(thread.id);
        if (!activities || !isResumableThread(thread)) continue;
        const pending = pendingUsageLimitResume({
          latestTurn: thread.latestTurn,
          activities,
          nowMs,
        });
        if (!pending) continue;
        yield* startWait({
          threadId: thread.id,
          turnId: pending.turnId,
          provider: thread.modelSelection.provider,
          resetsAt: pending.resetsAt,
          scheduledAt: new Date(nowMs).toISOString(),
        });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("usage-limit resume could not restore waits", { cause }),
      ),
    );

    // Subscribe before restoring so no failure or cancel falls between the two.
    const domainEvents = yield* engine.subscribeDomainEvents;
    yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, onRuntimeEvent), {
      startImmediately: true,
    });
    yield* Effect.forkScoped(Stream.runForEach(domainEvents, onDomainEvent), {
      startImmediately: true,
    });
    yield* Effect.forkScoped(
      Stream.runForEach(serverSettings.streamChanges, (settings) =>
        settings.autoContinueAtUsageLimit ? Effect.void : cancelAllWaits,
      ),
      { startImmediately: true },
    );
    yield* recover;
  });

  return { start } satisfies UsageLimitResumeShape;
});

export const UsageLimitResumeLive = Layer.effect(UsageLimitResume, make);
