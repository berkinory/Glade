import { Effect, Option, Fiber, Deferred, Exit, Cause } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { assert } from "@effect/vitest";
import { AGENT_GATEWAY_TURN_AUTHORITY_RETIRED } from "../../agentGateway/sessionLease.ts";
import { ProviderAdapterSessionNotFoundError, ProviderValidationError } from "../core/Errors.ts";
import {
  routing,
  asThreadId,
  asTurnId,
  asEventId,
  waitUntilEffect,
  asRuntimePayloadRecord,
  sleep,
  asRequestId,
} from "./providerServiceTestFixtures";

routing.layer("Provider service interruptionFences", (it) => {
  it.effect(
    "retires A's runtime before admitting B while allowing background tasks to finish",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-terminal-gateway-credential-rotation");
        const turnA = asTurnId(`turn-${threadId}`);

        yield* provider.startSession(threadId, {
          provider: "codex",
          threadId,
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });
        const initialBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const lifecycleGeneration = initialBinding?.lifecycleGeneration;
        assert.equal(typeof lifecycleGeneration, "string");
        yield* routing.codex.waitForRuntimeSubscribers();
        yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
        routing.codex.emit({
          type: "task.started",
          eventId: asEventId("terminal-rotation-background-started"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:00.000Z",
          threadId,
          lifecycleGeneration,
          payload: { taskId: "background-after-a" },
        });
        if (provider.hasLiveRuntimeTasks) {
          yield* waitUntilEffect(
            () => provider.hasLiveRuntimeTasks!({ threadId }),
            500,
            20,
            "background task ownership before terminal rotation",
          );
        }
        routing.codex.emit({
          type: "turn.completed",
          eventId: asEventId("terminal-rotation-turn-a-completed"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:01.000Z",
          threadId,
          turnId: turnA,
          lifecycleGeneration,
          payload: { state: "completed" },
          raw: {
            source: "codex.app-server.notification",
            method: "turn/completed",
            payload: { [AGENT_GATEWAY_TURN_AUTHORITY_RETIRED]: true },
          },
        });
        yield* waitUntilEffect(
          () =>
            directory.getBinding(threadId).pipe(
              Effect.map(
                Option.match({
                  onNone: () => false,
                  onSome: (binding) =>
                    asRuntimePayloadRecord(binding.runtimePayload)
                      .agentGatewayCredentialRotationRequired === true,
                }),
              ),
            ),
          500,
          20,
          "terminal credential retirement persistence",
        );

        const startsBeforeB = routing.codex.startSession.mock.calls.length;
        const stopsBeforeB = routing.codex.stopSession.mock.calls.length;
        const sendsBeforeB = routing.codex.sendTurn.mock.calls.length;
        const turnB = yield* provider
          .sendTurn({ threadId, input: "turn B", attachments: [] })
          .pipe(Effect.forkChild);
        yield* sleep(25);
        assert.equal(routing.codex.stopSession.mock.calls.length, stopsBeforeB);
        assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeB);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB);

        routing.codex.emit({
          type: "task.updated",
          eventId: asEventId("terminal-rotation-background-completed"),
          provider: "codex",
          createdAt: "2026-07-23T12:00:02.000Z",
          threadId,
          lifecycleGeneration,
          payload: { taskId: "background-after-a", status: "completed" },
        });
        yield* Fiber.join(turnB);

        assert.equal(routing.codex.stopSession.mock.calls.length, stopsBeforeB + 1);
        assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeB + 1);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB + 1);
        const recoveredBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        assert.equal(
          asRuntimePayloadRecord(recoveredBinding?.runtimePayload)
            .agentGatewayCredentialRotationRequired,
          false,
        );

        yield* provider.stopSession({ threadId });
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect(
    "fences a next turn before a targeted child interrupt acquires lifecycle ownership",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-child-interrupt-preflight-fence");
        const responseStarted = yield* Deferred.make<void>();
        const releaseResponse = yield* Deferred.make<void>();
        const defaultRespond = routing.codex.respondToRequest.getMockImplementation();
        assert.isDefined(defaultRespond);
        routing.codex.respondToRequest.mockImplementationOnce((...args) =>
          Deferred.succeed(responseStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseResponse)),
            Effect.andThen(defaultRespond!(...args)),
          ),
        );

        yield* provider.startSession(threadId, {
          provider: "codex",
          threadId,
          cwd: "/tmp/project",
          runtimeMode: "full-access",
        });
        yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
        const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        assert.isDefined(binding?.lifecycleGeneration);
        const sendsBeforeB = routing.codex.sendTurn.mock.calls.length;

        const heldLifecycle = yield* provider
          .respondToRequest({
            threadId,
            requestId: asRequestId("request-holding-lifecycle"),
            lifecycleGeneration: binding!.lifecycleGeneration,
            decision: "accept",
          })
          .pipe(Effect.forkChild);
        yield* Deferred.await(responseStarted);
        const targetedInterrupt = yield* provider
          .interruptTurn({
            threadId,
            turnId: asTurnId("turn-child-A"),
            providerThreadId: "provider-child-A",
          })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const nextTurn = yield* provider
          .sendTurn({ threadId, input: "turn B", attachments: [] })
          .pipe(Effect.forkChild);
        yield* sleep(10);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB);

        yield* Deferred.succeed(releaseResponse, undefined);
        yield* Fiber.join(heldLifecycle);
        yield* Fiber.join(targetedInterrupt);
        yield* Fiber.join(nextTurn);
        assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeB + 1);

        yield* provider.stopSession({ threadId });
      }),
  );

  it.effect("tombstones a targeted child stop even when its native interrupt fails", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-child-interrupt-uncertain-failure");
      routing.codex.interruptTurn.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: "codex",
            threadId,
          }),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const firstStop = yield* Effect.exit(
        provider.interruptTurn({
          threadId,
          turnId: asTurnId("turn-child-failed"),
          providerThreadId: "provider-child-failed",
        }),
      );
      assert.equal(Exit.isFailure(firstStop), true);
      const interruptCallsAfterFailure = routing.codex.interruptTurn.mock.calls.length;

      yield* provider.interruptTurn({
        threadId,
        turnId: asTurnId("turn-child-failed"),
        providerThreadId: "provider-child-failed",
      });
      assert.equal(routing.codex.interruptTurn.mock.calls.length, interruptCallsAfterFailure + 1);
      const interruptCallsAfterRetry = routing.codex.interruptTurn.mock.calls.length;

      yield* provider.sendTurn({ threadId, input: "turn B", attachments: [] });
      const startsAfterRotation = routing.codex.startSession.mock.calls.length;
      const stopsAfterRotation = routing.codex.stopSession.mock.calls.length;
      yield* provider.interruptTurn({
        threadId,
        turnId: asTurnId("turn-child-failed"),
        providerThreadId: "provider-child-failed",
      });
      assert.equal(routing.codex.interruptTurn.mock.calls.length, interruptCallsAfterRetry);

      yield* provider.sendTurn({ threadId, input: "turn C", attachments: [] });
      assert.equal(routing.codex.startSession.mock.calls.length, startsAfterRotation);
      assert.equal(routing.codex.stopSession.mock.calls.length, stopsAfterRotation);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("holds a concurrent next turn behind interrupted-runtime credential rotation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-credential-fence");
      const stopStarted = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = routing.codex.stopSession.getMockImplementation();
      assert.isDefined(defaultStop);
      routing.codex.stopSession.mockImplementationOnce((stoppedThreadId) =>
        Deferred.succeed(stopStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStop)),
          Effect.andThen(defaultStop!(stoppedThreadId)),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const sendCallsBeforeB = routing.codex.sendTurn.mock.calls.length;

      const interrupted = yield* provider.interruptTurn({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopStarted);
      const nextTurn = yield* provider
        .sendTurn({ threadId, input: "turn B", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendCallsBeforeB);

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(interrupted);
      yield* Fiber.join(nextTurn);
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendCallsBeforeB + 1);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("settles the interruption fence when its caller is cancelled during teardown", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-caller-cancelled");
      const stopStarted = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = routing.codex.stopSession.getMockImplementation();
      assert.isDefined(defaultStop);
      routing.codex.stopSession.mockImplementationOnce((stoppedThreadId) =>
        Deferred.succeed(stopStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStop)),
          Effect.andThen(defaultStop!(stoppedThreadId)),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      const sendsBeforeRecovery = routing.codex.sendTurn.mock.calls.length;

      const interrupted = yield* provider.interruptTurn({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopStarted);
      const cancellation = yield* Fiber.interrupt(interrupted).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(cancellation);
      yield* provider.sendTurn({ threadId, input: "turn B", attachments: [] });
      assert.equal(routing.codex.sendTurn.mock.calls.length, sendsBeforeRecovery + 1);

      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("fails closed when the interrupted runtime cannot be retired", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-interrupt-retirement-failure");
      routing.codex.stopSession.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: "codex",
            threadId,
          }),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId, input: "turn A", attachments: [] });
      assert.equal(Exit.isFailure(yield* Effect.exit(provider.interruptTurn({ threadId }))), true);

      const staleSecondInterrupt = yield* Effect.exit(
        provider.interruptTurn({ threadId, turnId: asTurnId("turn-stale-after-failure") }),
      );
      assert.equal(Exit.isFailure(staleSecondInterrupt), true);
      if (Exit.isFailure(staleSecondInterrupt)) {
        const failure = Cause.squash(staleSecondInterrupt.cause);
        assert.instanceOf(failure, ProviderValidationError);
        assert.match(failure.issue, /previous runtime could not be retired safely/);
      }

      const blocked = yield* Effect.exit(
        provider.sendTurn({ threadId, input: "turn B", attachments: [] }),
      );
      assert.equal(Exit.isFailure(blocked), true);
      if (Exit.isFailure(blocked)) {
        const failure = Cause.squash(blocked.cause);
        assert.instanceOf(failure, ProviderValidationError);
        assert.equal(failure.operation, "ProviderService.turnDispatch");
        assert.match(failure.issue, /could not be retired safely/);
      }

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      yield* provider.stopSession({ threadId });
    }),
  );
});
