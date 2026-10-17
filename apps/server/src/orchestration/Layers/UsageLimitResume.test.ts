import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationLatestTurn } from "@glade/contracts/orchestration/threadEntities";
import {
  USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/usageLimitResume";
import { Duration, Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import {
  makeThreadDetail,
  makeThreadShell,
} from "../../agentGateway/Layers/tests/gatewayTestFixtures.ts";
import {
  ProjectionThreadActivityRepository,
  type ProjectionThreadActivity,
} from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../server/config.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { UsageLimitResume } from "../Services/UsageLimitResume.ts";
import { UsageLimitResumeLive } from "./UsageLimitResume.ts";
import { failedTurn, makeRecordingEngine, unused } from "./resumeTestFixtures.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-limited");
const LIMITED_TURN = TurnId.makeUnsafe("turn-limited");
// TestClock starts at the epoch.
const RESETS_AT = new Date(Duration.toMillis(Duration.hours(1))).toISOString();

function makeHarness(input: { readonly persistedActivities?: ProjectionThreadActivity[] } = {}) {
  let latestTurn = failedTurn(LIMITED_TURN);
  // The service reads only the thread list.
  const readModel = (): OrchestrationReadModel =>
    ({
      threads: [
        makeThreadDetail(
          makeThreadShell(THREAD_ID, {
            modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
            latestTurn,
          }),
        ),
      ],
    }) as unknown as OrchestrationReadModel;

  return Effect.gen(function* () {
    const recording = yield* makeRecordingEngine(readModel);
    const layer = UsageLimitResumeLive.pipe(
      Layer.provide(Layer.succeed(OrchestrationEngineService, recording.engine)),
      Layer.provide(Layer.succeed(ProviderService, recording.providerService)),
      Layer.provide(
        Layer.succeed(ProjectionThreadActivityRepository, {
          getById: unused,
          upsert: unused,
          listByThreadId: unused,
          listByKinds: () => Effect.succeed(input.persistedActivities ?? []),
          deleteByThreadId: unused,
        }),
      ),
      // Disabled providers keep the reset-time usage check offline; it reports no exhausted window.
      Layer.provide(
        ServerSettingsService.layerTest({
          providers: { codex: { enabled: false }, claudeAgent: { enabled: false } },
        }),
      ),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-usage-limit-test-" })),
      Layer.provide(NodeServices.layer),
    );
    const service = yield* Effect.service(UsageLimitResume).pipe(Effect.provide(layer));
    yield* service.start();

    return {
      ...recording,
      setLatestTurn: (turn: OrchestrationLatestTurn) => {
        latestTurn = turn;
      },
      failWithUsageLimit: recording.publishRuntimeEvent({
        type: "runtime.error",
        eventId: EventId.makeUnsafe("event-limit"),
        provider: "claudeAgent",
        threadId: THREAD_ID,
        turnId: LIMITED_TURN,
        createdAt: new Date(0).toISOString(),
        payload: {
          message: "Claude rate limit reached.",
          failure: {
            kind: "rate_limited",
            retry: { state: "none" },
            action: "wait",
            resetsAt: RESETS_AT,
            httpStatus: null,
            message: "Claude rate limit reached.",
          },
        },
      }),
    };
  });
}

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

describe("UsageLimitResume", () => {
  it.effect("continues the stopped turn once, after the limit resets", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.failWithUsageLimit;
      yield* harness.advance("59 minutes");

      expect(harness.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
      yield* harness.advance("2 minutes");
      yield* harness.advance("1 hour");

      expect(harness.turnStarts()).toEqual([
        expect.objectContaining({
          threadId: THREAD_ID,
          dispatchOrigin: "agent",
          resumePrecondition: expect.objectContaining({ recordedTurnId: LIMITED_TURN }),
        }),
      ]);
    }).pipe(Effect.scoped),
  );

  const interruptions: ReadonlyArray<{
    readonly name: string;
    readonly interrupt: (harness: Harness) => Effect.Effect<unknown>;
  }> = [
    {
      name: "the wait is cancelled",
      interrupt: (harness) =>
        harness.publishDomainEvent({
          type: "thread.activity-appended",
          payload: {
            threadId: THREAD_ID,
            activity: {
              id: EventId.makeUnsafe("event-cancel"),
              tone: "info",
              kind: USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
              summary: "Automatic continue cancelled",
              payload: {},
              turnId: LIMITED_TURN,
              createdAt: new Date(0).toISOString(),
            },
          },
        } as OrchestrationEvent),
    },
    {
      name: "a newer turn ran",
      interrupt: (harness) =>
        Effect.sync(() =>
          harness.setLatestTurn(failedTurn(TurnId.makeUnsafe("turn-sent-by-hand"))),
        ),
    },
  ];

  for (const { name, interrupt } of interruptions) {
    it.effect(`never continues once ${name}`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.failWithUsageLimit;
        yield* harness.advance("1 minute");
        yield* interrupt(harness);
        yield* harness.advance("2 hours");

        expect(harness.turnStarts()).toEqual([]);
      }).pipe(Effect.scoped),
    );
  }

  it.effect("restores a scheduled wait after a restart", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        persistedActivities: [
          {
            activityId: EventId.makeUnsafe("event-scheduled"),
            threadId: THREAD_ID,
            turnId: LIMITED_TURN,
            tone: "info",
            kind: USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
            summary: "Continuing when the usage limit resets",
            payload: { resetsAt: RESETS_AT },
            createdAt: new Date(0).toISOString(),
          },
        ],
      });
      yield* harness.advance("2 hours");

      expect(harness.turnStarts()).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});
