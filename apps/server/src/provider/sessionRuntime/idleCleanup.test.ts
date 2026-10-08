import { Effect, Option } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterProcessError } from "../core/Errors.ts";
import { assert } from "@effect/vitest";
import {
  makeProviderServiceLayer,
  asThreadId,
  asEventId,
  waitUntil,
  sleep,
  waitUntilEffect,
  asRuntimePayloadRecord,
  asTurnId,
} from "./providerServiceTestFixtures";

const idleCleanup = makeProviderServiceLayer({ runtimeIdleStopMs: 100 });

idleCleanup.layer("ProviderServiceLive idle cleanup", (it) => {
  it.effect("retries failed idle teardown after a delayed session exit notification", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-idle-cleanup-retry");
      const originalStop = idleCleanup.codex.stopSession.getMockImplementation()!;
      idleCleanup.codex.stopSession.mockClear();
      idleCleanup.codex.stopSession.mockImplementationOnce((id) =>
        originalStop(id).pipe(
          Effect.andThen(
            Effect.fail(
              new ProviderAdapterProcessError({
                provider: "codex",
                threadId: id,
                detail: "Descendant still alive",
              }),
            ),
          ),
        ),
      );
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.completed",
        eventId: asEventId("idle-retry-completed"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { state: "completed" },
      });
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 1);
      yield* sleep(30);
      idleCleanup.codex.emit({
        type: "session.exited",
        eventId: asEventId("runtime-idle-delayed-exit"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { reason: "stopped" },
      });
      yield* waitUntilEffect(() =>
        directory
          .getBinding(threadId)
          .pipe(
            Effect.map(
              (binding) =>
                asRuntimePayloadRecord(Option.getOrUndefined(binding)?.runtimePayload)
                  .lastRuntimeEvent === "session.exited",
            ),
          ),
      );
      assert.isFalse(yield* idleCleanup.codex.adapter.hasSession(threadId));
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 2, 2_000);
      yield* waitUntilEffect(() =>
        directory
          .getBinding(threadId)
          .pipe(
            Effect.map(
              (binding) =>
                asRuntimePayloadRecord(Option.getOrUndefined(binding)?.runtimePayload)
                  .lastRuntimeEvent === "provider.stopRuntimeSession",
            ),
          ),
      );
      yield* provider.stopSession({ threadId });
    }),
  );

  it.effect("cancels a pending idle cleanup retry when new user work starts", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-idle-retry-new-work");
      idleCleanup.codex.stopSession.mockClear();
      idleCleanup.codex.stopSession.mockReturnValueOnce(
        Effect.fail(
          new ProviderAdapterProcessError({
            provider: "codex",
            threadId,
            detail: "Temporary cleanup failure",
          }),
        ),
      );
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.completed",
        eventId: asEventId("idle-retry-new-work-completed"),
        provider: "codex",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { state: "completed" },
      });
      yield* waitUntil(() => idleCleanup.codex.stopSession.mock.calls.length === 1);
      yield* sleep(30);
      yield* provider.sendTurn({ threadId, input: "new work" });
      yield* sleep(1_100);
      assert.equal(idleCleanup.codex.stopSession.mock.calls.length, 1);
      assert.isTrue(yield* idleCleanup.codex.adapter.hasSession(threadId));
      yield* provider.stopSession({ threadId });
    }),
  );

  const childRefs = {
    providerRefs: { providerThreadId: "native-child-1", providerParentThreadId: "native-parent" },
  };
  const collabCall = (status: string) => ({
    type: "item.completed",
    payload: {
      itemType: "collab_agent_tool_call",
      data: { agentsStates: { "native-child-1": { status } } },
    },
  });
  it.effect.each([
    {
      source: "claudeAgent",
      provider: "claudeAgent",
      started: { type: "task.started", payload: { taskId: "background-task-1" } },
      settled: {
        type: "task.updated",
        payload: { taskId: "background-task-1", status: "completed" },
      },
    },
    {
      source: "codex",
      provider: "codex",
      started: collabCall("running"),
      settled: collabCall("completed"),
    },
    {
      source: "codexChildTurn",
      provider: "codex",
      started: { type: "turn.started", payload: {}, ...childRefs },
      settled: { type: "turn.completed", payload: { state: "completed" }, ...childRefs },
    },
  ] as const)("keeps $source alive until native background tasks settle", (row) =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-idle-background-task");
      const adapter = row.provider === "codex" ? idleCleanup.codex : idleCleanup.claude;
      const emit = (
        eventId: string,
        createdAt: string,
        event: { readonly type: string; readonly [key: string]: unknown },
      ) =>
        adapter.emit({
          ...event,
          eventId: asEventId(eventId),
          provider: row.provider,
          createdAt,
          threadId,
        });

      adapter.stopSession.mockClear();
      const session = yield* provider.startSession(threadId, {
        provider: row.provider,
        threadId,
        runtimeMode: "full-access",
      });
      yield* adapter.waitForRuntimeSubscribers();
      emit("runtime-background-task-started", "2026-07-16T20:00:00.000Z", row.started);
      emit("runtime-background-parent-completed", "2026-07-16T20:00:01.000Z", {
        type: "turn.completed",
        payload: { state: "completed" },
      });

      yield* sleep(150);
      assert.equal(adapter.stopSession.mock.calls.length, 0);

      emit("runtime-background-task-completed", "2026-07-16T20:00:02.000Z", row.settled);
      yield* waitUntil(
        () => adapter.stopSession.mock.calls.length > 0,
        500,
        20,
        "idle runtime stop after background task settlement",
      );
      assert.deepEqual(adapter.stopSession.mock.calls[0]?.[0], session.threadId);
    }),
  );

  it.effect("keeps lifecycle ownership on the first of two conflicting turn starts", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-conflicting-runtime-starts");
      const firstTurnId = asTurnId("turn-conflicting-start-first");
      const secondTurnId = asTurnId("turn-conflicting-start-second");

      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* idleCleanup.codex.waitForRuntimeSubscribers();
      idleCleanup.codex.emit({
        type: "turn.started",
        eventId: asEventId("runtime-conflicting-start-first"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:01.000Z",
        threadId,
        turnId: firstTurnId,
        payload: { state: "running" },
      });
      yield* waitUntilEffect(
        () =>
          directory.getBinding(threadId).pipe(
            Effect.map((current) => {
              const binding = Option.getOrUndefined(current);
              const payload = binding?.runtimePayload as Record<string, unknown> | undefined;
              return payload?.activeTurnId === firstTurnId;
            }),
          ),
        500,
        20,
        "first runtime turn start persistence",
      );

      idleCleanup.codex.emit({
        type: "turn.started",
        eventId: asEventId("runtime-conflicting-start-second"),
        provider: "codex",
        createdAt: "2026-02-27T00:04:02.000Z",
        threadId,
        turnId: secondTurnId,
        payload: { state: "running" },
      });
      yield* sleep(50);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const payload = binding?.runtimePayload as Record<string, unknown>;
      assert.equal(binding?.status, "running");
      assert.equal(payload.activeTurnId, firstTurnId);
      assert.equal(payload.lastRuntimeEvent, "turn.started");
    }),
  );
});
