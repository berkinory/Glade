import { it } from "@effect/vitest";
import { EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationMessage } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  makeThreadDetail,
  makeThreadShell,
} from "../../agentGateway/Layers/tests/gatewayTestFixtures.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { TransientFailureResume } from "../Services/TransientFailureResume.ts";
import { TransientFailureResumeLive } from "./TransientFailureResume.ts";
import { failedTurn, makeRecordingEngine } from "./resumeTestFixtures.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-dropped");

const failure = (overrides: Partial<ProviderFailure>): ProviderFailure => ({
  kind: "internal",
  retry: { state: "none" },
  action: "retry",
  resetsAt: null,
  httpStatus: null,
  message: "Claude returned a server error. Retry in a moment.",
  ...overrides,
});

function makeHarness() {
  let latestTurn = failedTurn(TurnId.makeUnsafe("turn-0"));
  // Each resume the service sent is a user message of the thread.
  let sentResumes = (): OrchestrationMessage[] => [];
  return Effect.gen(function* () {
    const recording = yield* makeRecordingEngine(
      () =>
        ({
          threads: [
            {
              ...makeThreadDetail(makeThreadShell(THREAD_ID, { latestTurn })),
              messages: sentResumes(),
            },
          ],
        }) as unknown as OrchestrationReadModel, // The service reads only the thread list.
    );
    sentResumes = () =>
      recording
        .turnStarts()
        .flatMap((command) =>
          command.type === "thread.turn.start"
            ? [{ id: command.message.messageId, role: "user" } as OrchestrationMessage]
            : [],
        );
    const service = yield* Effect.service(TransientFailureResume).pipe(
      Effect.provide(
        TransientFailureResumeLive.pipe(
          Layer.provide(Layer.succeed(OrchestrationEngineService, recording.engine)),
          Layer.provide(Layer.succeed(ProviderService, recording.providerService)),
        ),
      ),
    );
    yield* recording.onHost(service.start());

    return {
      ...recording,
      waiting: Stream.runHead(service.streamWaiting).pipe(Effect.map(Option.getOrThrow)),
      fail: (turn: string, providerFailure: ProviderFailure) => {
        latestTurn = failedTurn(TurnId.makeUnsafe(turn));
        return recording.publishRuntimeEvent({
          type: "runtime.error",
          eventId: EventId.makeUnsafe(`event-${turn}`),
          provider: "claudeAgent",
          threadId: THREAD_ID,
          turnId: TurnId.makeUnsafe(turn),
          createdAt: new Date(0).toISOString(),
          payload: { message: providerFailure.message, failure: providerFailure },
        });
      },
    };
  });
}

describe("TransientFailureResume", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly failure: ProviderFailure;
    readonly resumes: boolean;
  }> = [
    { name: "a failing API the provider stopped retrying", failure: failure({}), resumes: true },
    {
      name: "a lost connection",
      failure: failure({ kind: "connection_lost", action: null }),
      resumes: true,
    },
    {
      name: "an overloaded API",
      failure: failure({ kind: "overloaded", action: "wait" }),
      resumes: true,
    },
    {
      name: "a failure the provider is still retrying",
      failure: failure({ kind: "connection_lost", retry: { state: "retrying" } }),
      resumes: false,
    },
    {
      name: "a rejected request",
      failure: failure({ kind: "bad_request", action: null }),
      resumes: false,
    },
    {
      name: "a usage limit",
      failure: failure({ kind: "rate_limited", action: "wait" }),
      resumes: false,
    },
  ];

  for (const { name, failure: providerFailure, resumes } of cases) {
    it.effect(`${resumes ? "continues" : "leaves"} a chat stopped by ${name}`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* harness.fail("turn-0", providerFailure);
        yield* harness.advance("29 seconds");
        expect(harness.turnStarts()).toEqual([]);

        yield* harness.advance("1 hour");
        expect(harness.turnStarts()).toEqual(
          resumes
            ? [
                expect.objectContaining({
                  threadId: THREAD_ID,
                  dispatchOrigin: "agent",
                  resumePrecondition: expect.objectContaining({
                    recordedTurnId: TurnId.makeUnsafe("turn-0"),
                  }),
                }),
              ]
            : [],
        );
      }).pipe(Effect.scoped),
    );
  }

  it.effect("waits longer before each resume and stops after six", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (let turn = 0; turn < 7; turn += 1) {
        yield* harness.fail(`turn-${turn}`, failure({}));
        yield* harness.advance("20 minutes");
      }

      expect(harness.turnStarts()).toHaveLength(6);
      const delays = harness.dispatched.flatMap((command) =>
        command.type === "thread.activity.append"
          ? [(command.activity.payload as { readonly delayMs: number }).delayMs]
          : [],
      );
      expect(delays).toHaveLength(6);
      expect(delays.every((delay, index) => index === 0 || delay > delays[index - 1]!)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("continues a chat once the host is back from sleep", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.fail("turn-0", failure({}));
      yield* harness.advance("10 seconds");
      yield* harness.sleepHost("3 hours");
      for (let darkWake = 0; darkWake < 4; darkWake += 1) {
        yield* harness.advance("5 seconds");
        yield* harness.sleepHost("25 seconds");
      }
      yield* harness.advance("20 seconds");
      expect(harness.turnStarts()).toEqual([]);

      yield* harness.advance("1 minute");
      expect(harness.turnStarts()).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("holds the wait for keep-awake until the user takes the chat over", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.fail("turn-0", failure({}));
      yield* harness.advance("10 seconds");
      expect(yield* harness.waiting).toBe(true);

      yield* harness.publishDomainEvent({
        type: "thread.turn-start-requested",
        aggregateKind: "thread",
        aggregateId: THREAD_ID,
        payload: { threadId: THREAD_ID },
      } as unknown as OrchestrationEvent); // The service reads only the type and aggregate.
      yield* harness.advance("1 hour");

      expect(yield* harness.waiting).toBe(false);
      expect(harness.turnStarts()).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
