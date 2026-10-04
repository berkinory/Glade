import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from "../../provider/core/Errors";
import { makeReactorTestHarness, asMessageId, asTurnId, waitFor } from "./reactorTestFixtures";

// Preparation evidence has its own durable tests. This boundary protects editing-runtime ownership
// and native acceptance: a queued intent or a newly opened destination is not delivery.
describe("same-chat handoff delivery", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();
  const threadId = ThreadId.makeUnsafe("thread-1");
  const operationId = CommandId.makeUnsafe("switch-provider");
  const destination = { provider: "claudeAgent" as const, model: "selected-claude" };
  const date = new Date().toISOString();

  const prepared = async () => {
    const harness = await createHarness({
      handoffContext: "Frozen original evidence api_key=private-test-token",
      serverSettings: { providers: { claudeAgent: { enabled: true } } },
    });
    await harness.seedUserMessage({
      threadId,
      messageId: asMessageId("original"),
      text: "Keep my database",
      createdAt: date,
    });
    await Effect.runPromise(
      harness.startSession(threadId, {
        threadId,
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "approval-required",
        cwd: "/tmp/provider-project",
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.handoff.start",
        commandId: operationId,
        threadId,
        modelSelection: destination,
        runtimeMode: "approval-required",
        createdAt: date,
      }),
    );
    const thread = (await readHarnessThread(harness))!;
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("prepared"),
        threadId,
        expectedHandoffOperationId: operationId,
        handoff: { ...thread.handoff!, stage: "ready" },
      }),
    );
    return harness;
  };
  const send = (harness: Awaited<ReturnType<typeof prepared>>, commandId = "send") =>
    Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(commandId),
        threadId,
        handoffOperationId: operationId,
        modelSelection: destination,
        message: {
          messageId: asMessageId(commandId),
          role: "user",
          text: "Continue",
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt: date,
      }),
    );

  it("retires the source before admission, refuses concurrent sends and records delivery only on native acceptance", async () => {
    const harness = await prepared();
    const accepted = Deferred.makeUnsafe<{
      threadId: typeof threadId;
      turnId: ReturnType<typeof asTurnId>;
    }>();
    harness.sendTurn.mockImplementation(() => Deferred.await(accepted));
    await send(harness);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const pending = (await readHarnessThread(harness))!;
    expect(pending.handoff?.stage).toBe("activated");
    expect(pending.handoff?.bootstrapStatus).toBe("pending");
    expect(pending.id).toBe(threadId);
    expect(pending.title).toBe("Thread");
    expect(harness.stopSession.mock.invocationCallOrder[0]).toBeLessThan(
      harness.startSession.mock.invocationCallOrder[1]!,
    );
    expect(
      (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
    ).toEqual(["claudeAgent"]);
    await expect(send(harness, "duplicate")).rejects.toThrow("Resolve any uncertain delivery");
    await Effect.runPromise(
      Deferred.succeed(accepted, { threadId, turnId: asTurnId("destination-turn") }),
    );
    await harness.drain();
    const delivered = (await readHarnessThread(harness))!;
    expect(delivered.handoff?.stage).toBe("delivered");
    expect(delivered.handoff?.bootstrapStatus).toBe("completed");
    expect(delivered.messages.find((message) => message.id === "original")?.text).toBe(
      "Keep my database",
    );
    expect(harness.sendTurn.mock.calls[0]?.[0].input).toContain("Frozen original evidence");
    const detail = asObjectRecord(
      delivered.activities.find((activity) => activity.kind === "provider.transition")?.payload,
    )?.detail;
    expect(typeof detail).toBe("string");
    expect(() => JSON.parse(String(detail))).not.toThrow();
    expect(detail).not.toContain("private-test-token");
    expect(detail).toContain("[redacted]");
  });

  it.each(["cancelled", "source-changed"] as const)(
    "retires late destination startup without sending after %s",
    async (failure) => {
      const harness = await prepared();
      const starting = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      const start = harness.startSessionWithOutcome.getMockImplementation()!;
      harness.startSessionWithOutcome.mockImplementation((...args) =>
        Deferred.succeed(starting, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.suspend(() => start(...args))),
        ),
      );
      await send(harness);
      await Effect.runPromise(Deferred.await(starting));
      if (failure === "cancelled")
        await Effect.runPromise(harness.handoffTransitions!.abort(threadId, operationId));
      else
        await harness.seedUserMessage({
          threadId,
          messageId: asMessageId("changed-during-startup"),
          text: "New source evidence",
          createdAt: date,
        });
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await harness.drain();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(await Effect.runPromise(harness.listSessions())).toEqual([]);
      expect((await readHarnessThread(harness))?.handoff?.stage).toBe(
        failure === "cancelled" ? "cancelled" : "failed",
      );
    },
  );

  it.each(["startup", "rejected", "uncertain"] as const)(
    "preserves bootstrap and a truthful durable outcome after %s failure",
    async (failure) => {
      const harness = await prepared();
      if (failure === "startup")
        harness.startSessionWithOutcome.mockImplementation(() =>
          Effect.fail(
            new ProviderAdapterValidationError({
              provider: "claudeAgent",
              operation: "startSession",
              issue: "Cannot start destination",
            }),
          ),
        );
      else
        harness.sendTurn.mockImplementation(() =>
          Effect.fail(
            failure === "rejected"
              ? new ProviderAdapterValidationError({
                  provider: "claudeAgent",
                  operation: "sendTurn",
                  issue: "Native request rejected",
                })
              : new ProviderAdapterRequestError({
                  provider: "claudeAgent",
                  method: "sendTurn",
                  detail: "Connection lost before acknowledgement",
                }),
          ),
        );
      await send(harness);
      await harness.drain();
      const thread = (await readHarnessThread(harness))!;
      expect(thread.handoff?.stage).toBe(failure === "uncertain" ? "uncertain" : "failed");
      expect(thread.handoff?.bootstrapStatus).toBe("pending");
      expect(thread.messages.find((message) => message.id === "original")?.text).toBe(
        "Keep my database",
      );
      expect(harness.sendTurn).toHaveBeenCalledTimes(failure === "startup" ? 0 : 1);
      expect(
        thread.activities.some(
          (activity) =>
            activity.kind === "provider.transition" &&
            activity.summary.includes(thread.handoff!.stage!),
        ),
      ).toBe(true);
    },
  );
});
