import { it } from "@effect/vitest";
import {
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { makeRecordingEngine } from "../../orchestration/Layers/resumeTestFixtures.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import { ProviderTurnWatchdog } from "../Services/ProviderTurnWatchdog.ts";
import { ProviderTurnWatchdogLive } from "./ProviderTurnWatchdog.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-watchdog");
const TURN_ID = TurnId.makeUnsafe("turn-watchdog");
const COMMAND_ITEM = RuntimeItemId.makeUnsafe("item-command");

type EventInput = {
  readonly [K in ProviderRuntimeEvent["type"]]: Omit<
    Extract<ProviderRuntimeEvent, { type: K }>,
    "eventId" | "provider" | "threadId" | "createdAt"
  >;
}[ProviderRuntimeEvent["type"]];

function makeHarness() {
  let activeTurnId: TurnId | undefined = TURN_ID;
  let liveTasks = false;
  let nextEvent = 0;
  return Effect.gen(function* () {
    const recording = yield* makeRecordingEngine(() => ({}) as OrchestrationReadModel);
    const providerService = {
      ...recording.providerService,
      listSessions: () =>
        Effect.sync(
          (): ReadonlyArray<ProviderSession> => [
            {
              provider: "codex",
              status: "running",
              runtimeMode: "full-access",
              threadId: THREAD_ID,
              ...(activeTurnId ? { activeTurnId } : {}),
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            },
          ],
        ),
      hasLiveRuntimeTasks: () => Effect.sync(() => liveTasks),
    } as ProviderServiceShape; // The watchdog reads only events, sessions and live tasks.
    const watchdog = yield* Effect.service(ProviderTurnWatchdog).pipe(
      Effect.provide(
        ProviderTurnWatchdogLive.pipe(
          Layer.provide(Layer.succeed(OrchestrationEngineService, recording.engine)),
          Layer.provide(Layer.succeed(ProviderService, providerService)),
        ),
      ),
    );
    yield* recording.onHost(watchdog.start());

    const emit = (input: EventInput) =>
      recording.publishRuntimeEvent({
        eventId: EventId.makeUnsafe(`event-${nextEvent++}`),
        provider: "codex",
        threadId: THREAD_ID,
        createdAt: new Date(0).toISOString(),
        ...input,
      } as ProviderRuntimeEvent);

    return {
      emit,
      advance: recording.advance,
      sleepHost: recording.sleepHost,
      setActiveTurn: (turnId: TurnId | undefined) => {
        activeTurnId = turnId;
      },
      setLiveTasks: (live: boolean) => {
        liveTasks = live;
      },
      interrupts: () =>
        recording.dispatched.filter((command) => command.type === "thread.turn.interrupt"),
      notices: () =>
        recording.dispatched.filter(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "runtime.warning",
        ),
    };
  });
}

const turnStarted = (turnId: TurnId = TURN_ID, lifecycleGeneration = "gen-1"): EventInput => ({
  type: "turn.started",
  turnId,
  lifecycleGeneration,
  payload: {},
});

const commandStarted: EventInput = {
  type: "item.started",
  turnId: TURN_ID,
  lifecycleGeneration: "gen-1",
  itemId: COMMAND_ITEM,
  payload: { itemType: "command_execution", status: "inProgress", title: "Command" },
};

describe("ProviderTurnWatchdog", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly events: ReadonlyArray<EventInput>;
    readonly liveTasks?: boolean;
    readonly stops: boolean;
  }> = [
    { name: "a silent turn with nothing in flight", events: [], stops: true },
    { name: "a silent turn while a command runs", events: [commandStarted], stops: false },
    {
      name: "a silent turn after its command finished",
      events: [
        commandStarted,
        {
          type: "item.completed",
          turnId: TURN_ID,
          lifecycleGeneration: "gen-1",
          itemId: COMMAND_ITEM,
          payload: { itemType: "command_execution", status: "completed", title: "Command" },
        },
      ],
      stops: true,
    },
    {
      name: "a turn waiting on an approval",
      events: [
        {
          type: "request.opened",
          turnId: TURN_ID,
          lifecycleGeneration: "gen-1",
          requestId: RuntimeRequestId.makeUnsafe("request-approval"),
          payload: { requestType: "command_execution_approval", detail: "rm -rf build" },
        },
      ],
      stops: false,
    },
    {
      name: "a turn waiting on a user answer",
      events: [
        {
          type: "user-input.requested",
          turnId: TURN_ID,
          lifecycleGeneration: "gen-1",
          requestId: RuntimeRequestId.makeUnsafe("request-question"),
          payload: {
            questions: [
              {
                id: "q",
                header: "Pick",
                question: "Which?",
                options: [{ label: "A", description: "a" }],
              },
            ],
          },
        },
      ],
      stops: false,
    },
    { name: "a turn whose subagents still run", events: [], liveTasks: true, stops: false },
  ];

  for (const { name, events, liveTasks = false, stops } of cases) {
    it.effect(`${stops ? "stops" : "keeps"} ${name}`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        harness.setLiveTasks(liveTasks);
        yield* harness.emit(turnStarted());
        for (const event of events) yield* harness.emit(event);

        yield* harness.advance("14 minutes");
        expect(harness.interrupts()).toEqual([]);

        yield* harness.advance("2 hours");
        expect(harness.interrupts()).toEqual(
          stops ? [expect.objectContaining({ threadId: THREAD_ID, turnId: TURN_ID })] : [],
        );
        expect(harness.notices()).toHaveLength(stops ? 1 : 0);
      }).pipe(Effect.scoped),
    );
  }

  it.effect("restarts the silence window on every runtime event", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.emit(turnStarted());
      yield* harness.advance("10 minutes");
      yield* harness.emit({
        type: "content.delta",
        turnId: TURN_ID,
        lifecycleGeneration: "gen-1",
        payload: { streamKind: "assistant_text", delta: "still here" },
      });
      yield* harness.advance("14 minutes");
      expect(harness.interrupts()).toEqual([]);

      yield* harness.advance("2 minutes");
      expect(harness.interrupts()).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("restarts the silence window after the host slept", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.emit(turnStarted());
      yield* harness.advance("1 minute");
      yield* harness.sleepHost("3 hours");
      yield* harness.advance("1 minute");
      expect(harness.interrupts()).toEqual([]);

      yield* harness.advance("15 minutes");
      expect(harness.interrupts()).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("ignores a stale generation closing the newer turn's command", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const newerTurn = TurnId.makeUnsafe("turn-newer");
      harness.setActiveTurn(newerTurn);
      yield* harness.emit(turnStarted());
      yield* harness.emit(turnStarted(newerTurn, "gen-2"));
      yield* harness.emit({ ...commandStarted, turnId: newerTurn, lifecycleGeneration: "gen-2" });
      yield* harness.emit({
        type: "item.completed",
        lifecycleGeneration: "gen-1",
        itemId: COMMAND_ITEM,
        payload: { itemType: "command_execution", status: "failed", title: "Command" },
      });

      yield* harness.advance("2 hours");
      expect(harness.interrupts()).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("never stops a turn the live provider no longer runs", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.emit(turnStarted());
      harness.setActiveTurn(TurnId.makeUnsafe("turn-replacement"));

      yield* harness.advance("2 hours");
      expect(harness.interrupts()).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
