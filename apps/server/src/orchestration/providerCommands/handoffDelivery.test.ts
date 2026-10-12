import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from "../../provider/core/Errors";
import { makeReactorTestHarness, asMessageId, asTurnId, waitFor } from "./reactorTestFixtures";

// Protects the provider-switch lifecycle at the reactor boundary: nothing is retired until the next
// send, the source's native session is parked, a return resumes it with only the missed delta, and
// delivery is recorded only on native acceptance.
describe("provider handoff delivery", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();
  const threadId = ThreadId.makeUnsafe("thread-1");
  const codex = { provider: "codex" as const, model: "gpt-5-codex" };
  const claude = { provider: "claudeAgent" as const, model: "claude-opus-5-5" };
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 10, minute)).toISOString();
  type Harness = Awaited<ReturnType<typeof createHarness>>;

  const startedChat = async (options: { readonly injectHistory?: boolean } = {}) => {
    const harness = await createHarness({
      serverSettings: { providers: { claudeAgent: { enabled: true } } },
      ...options,
    });
    await harness.seedUserMessage({
      threadId,
      messageId: asMessageId("original"),
      text: "Keep my database api_key=private-test-token",
      createdAt: at(0),
      turnId: asTurnId("original-turn"),
    });
    await Effect.runPromise(
      harness.startSession(threadId, {
        threadId,
        modelSelection: codex,
        runtimeMode: "approval-required",
        cwd: "/tmp/provider-project",
      }),
    );
    return harness;
  };
  const switchTo = (harness: Harness, modelSelection: ModelSelection, operationId: string) =>
    Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.handoff.start",
        commandId: CommandId.makeUnsafe(operationId),
        threadId,
        modelSelection,
        runtimeMode: "approval-required",
        createdAt: at(1),
      }),
    );
  const send = (
    harness: Harness,
    input: {
      readonly operationId: string;
      readonly modelSelection: ModelSelection;
      readonly messageId: string;
      readonly text: string;
      readonly minute: number;
    },
  ) =>
    Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(input.messageId),
        threadId,
        handoffOperationId: CommandId.makeUnsafe(input.operationId),
        modelSelection: input.modelSelection,
        message: {
          messageId: asMessageId(input.messageId),
          role: "user",
          text: input.text,
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt: at(input.minute),
      }),
    );
  const settleTurn = async (harness: Harness, provider: ModelSelection["provider"]) => {
    for (const status of ["running", "ready"] as const)
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe(`settle-${provider}-${status}`),
          threadId,
          session: {
            threadId,
            providerName: provider,
            status,
            activeTurnId: status === "running" ? asTurnId("turn-1") : null,
            lastError: null,
            runtimeMode: "approval-required",
            updatedAt: at(5),
          },
          createdAt: at(5),
        }),
      );
    harness.setRuntimeSessionTurnState({ threadId, status: "ready" });
    await harness.drain();
  };

  it.each([
    { injectHistory: false, channel: "inline" },
    { injectHistory: true, channel: "injected" },
  ] as const)(
    "parks the source on send and records $channel delivery only on native acceptance",
    async ({ injectHistory, channel }) => {
      const harness = await startedChat({ injectHistory });
      await switchTo(harness, claude, "to-claude");
      const switched = (await readHarnessThread(harness))!;
      expect(switched.modelSelection).toEqual(claude);
      expect(switched.handoff?.stage).toBe("pending");
      expect(harness.parkSession).not.toHaveBeenCalled();

      const accepted = Deferred.makeUnsafe<{
        threadId: typeof threadId;
        turnId: ReturnType<typeof asTurnId>;
      }>();
      harness.sendTurn.mockImplementation(() => Deferred.await(accepted));
      await send(harness, {
        operationId: "to-claude",
        modelSelection: claude,
        messageId: "continue",
        text: "Continue",
        minute: 2,
      });
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      expect((await readHarnessThread(harness))?.handoff?.stage).toBe("pending");
      expect(harness.parkSession.mock.calls[0]?.[0]).toMatchObject({
        provider: "codex",
        lastSeenMessageId: "original",
      });
      expect(harness.parkSession.mock.invocationCallOrder[0]).toBeLessThan(
        harness.startSessionWithOutcome.mock.invocationCallOrder[0]!,
      );

      await Effect.runPromise(
        Deferred.succeed(accepted, { threadId, turnId: asTurnId("destination-turn") }),
      );
      await harness.drain();
      const delivered = (await readHarnessThread(harness))!;
      expect(delivered.handoff).toMatchObject({
        stage: "delivered",
        strategy: "fresh",
        channel,
        deliveryMessageId: "continue",
      });
      const input = String(harness.sendTurn.mock.calls[0]?.[0].input);
      if (injectHistory) {
        expect(JSON.stringify(harness.injectHistory.mock.calls[0]?.[0].items)).toContain(
          "Keep my database",
        );
        expect(input).not.toContain("Keep my database");
      } else expect(input).toContain("Keep my database");
      const detail = asObjectRecord(
        delivered.activities.find((activity) => activity.kind === "provider.transition")?.payload,
      )?.detail;
      expect(String(detail)).not.toContain("private-test-token");
      expect(
        (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
      ).toEqual(["claudeAgent"]);
    },
  );

  it("returns to a parked provider by resuming it with only what happened meanwhile", async () => {
    const harness = await startedChat();
    await switchTo(harness, claude, "to-claude");
    await send(harness, {
      operationId: "to-claude",
      modelSelection: claude,
      messageId: "claude-request",
      text: "Rename the table",
      minute: 2,
    });
    await harness.drain();
    await settleTurn(harness, "claudeAgent");

    await switchTo(harness, codex, "back-to-codex");
    await send(harness, {
      operationId: "back-to-codex",
      modelSelection: codex,
      messageId: "codex-request",
      text: "Carry on",
      minute: 6,
    });
    await harness.drain();

    expect(harness.startSessionWithOutcome.mock.calls.at(-1)?.[1].resumeCursor).toEqual({
      opaque: "resume-1",
    });
    const input = String(harness.sendTurn.mock.calls.at(-1)?.[0].input);
    expect(input).toContain("Rename the table");
    expect(input).not.toContain("Keep my database");
    expect((await readHarnessThread(harness))?.handoff).toMatchObject({
      stage: "delivered",
      strategy: "resumed",
    });
  });

  it.each(["startup", "rejected", "uncertain"] as const)(
    "keeps the switch truthful after a %s failure",
    async (failure) => {
      const harness = await startedChat();
      await switchTo(harness, claude, "to-claude");
      if (failure === "startup")
        harness.startSessionWithOutcome.mockImplementationOnce(() =>
          Effect.fail(
            new ProviderAdapterValidationError({
              provider: "claudeAgent",
              operation: "startSession",
              issue: "Cannot start destination",
            }),
          ),
        );
      else
        harness.sendTurn.mockImplementationOnce(() =>
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
      await send(harness, {
        operationId: "to-claude",
        modelSelection: claude,
        messageId: "first-try",
        text: "Continue",
        minute: 2,
      });
      await harness.drain();
      const failed = (await readHarnessThread(harness))!;
      if (failure === "uncertain") {
        expect(failed.handoff?.stage).toBe("uncertain");
        return;
      }
      expect(failed.handoff?.stage).toBe("pending");
      expect(failed.handoff?.detail).toBeDefined();

      await send(harness, {
        operationId: "to-claude",
        modelSelection: claude,
        messageId: "retry",
        text: "Try again",
        minute: 3,
      });
      await harness.drain();
      expect((await readHarnessThread(harness))?.handoff?.stage).toBe("delivered");
      expect(String(harness.sendTurn.mock.calls.at(-1)?.[0].input)).toContain("Keep my database");
    },
  );

  it.each(["switching back", "cancelling"] as const)(
    "%s before sending restores the source without touching its session",
    async (undo) => {
      const harness = await startedChat();
      await switchTo(harness, claude, "to-claude");
      if (undo === "switching back") await switchTo(harness, codex, "back-again");
      else
        await Effect.runPromise(
          harness.engine.dispatch({
            type: "thread.handoff.cancel",
            commandId: CommandId.makeUnsafe("cancel"),
            threadId,
            operationId: CommandId.makeUnsafe("to-claude"),
            createdAt: at(2),
          }),
        );
      await harness.drain();
      const thread = (await readHarnessThread(harness))!;
      expect(thread.handoff?.stage).toBe("cancelled");
      expect(thread.modelSelection).toEqual(codex);
      expect(harness.parkSession).not.toHaveBeenCalled();
      expect(
        (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
      ).toEqual(["codex"]);
    },
  );

  it("switching back after a failed delivery resumes the parked source", async () => {
    const harness = await startedChat();
    await switchTo(harness, claude, "to-claude");
    harness.sendTurn.mockImplementationOnce(() =>
      Effect.fail(
        new ProviderAdapterValidationError({
          provider: "claudeAgent",
          operation: "sendTurn",
          issue: "Native request rejected",
        }),
      ),
    );
    await send(harness, {
      operationId: "to-claude",
      modelSelection: claude,
      messageId: "rejected",
      text: "Rename the table",
      minute: 2,
    });
    await harness.drain();
    await switchTo(harness, codex, "back-to-codex");
    expect((await readHarnessThread(harness))?.handoff?.stage).toBe("pending");
    await send(harness, {
      operationId: "to-claude",
      modelSelection: codex,
      messageId: "codex-request",
      text: "Carry on",
      minute: 3,
    });
    await harness.drain();
    expect(harness.startSessionWithOutcome.mock.calls.at(-1)?.[1].resumeCursor).toEqual({
      opaque: "resume-1",
    });
    expect(String(harness.sendTurn.mock.calls.at(-1)?.[0].input)).toContain("Rename the table");
    expect(
      (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
    ).toEqual(["codex"]);
  });

  it("starts the destination even while the projection still reports the source provider", async () => {
    const harness = await startedChat();
    await switchTo(harness, claude, "to-claude");
    harness.interceptEngineDispatch((command) =>
      command.type === "thread.session.set" &&
      String(command.commandId).startsWith("server:handoff-source-parked")
        ? Effect.succeed({ sequence: 0 })
        : undefined,
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("source-projection"),
        threadId,
        session: {
          threadId,
          providerName: "codex",
          status: "ready",
          activeTurnId: null,
          lastError: null,
          runtimeMode: "approval-required",
          updatedAt: at(1),
        },
        createdAt: at(1),
      }),
    );
    await send(harness, {
      operationId: "to-claude",
      modelSelection: claude,
      messageId: "continue",
      text: "Continue",
      minute: 2,
    });
    await harness.drain();
    expect((await readHarnessThread(harness))?.handoff?.stage).toBe("delivered");
    expect(
      (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
    ).toEqual(["claudeAgent"]);
  });
});

describe("provider switch before any provider delivery", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();
  const threadId = ThreadId.makeUnsafe("thread-1");
  const claude = { provider: "claudeAgent" as const, model: "claude-opus-5-5" };
  const skills = [{ name: "release", path: "/skills/release/SKILL.md" }];
  const date = new Date().toISOString();

  it.each([
    { reachedProvider: false, outcome: "switches directly and resends the failed message once" },
    { reachedProvider: true, outcome: "keeps the handoff once a provider turn started" },
  ])("$outcome", async ({ reachedProvider }) => {
    const harness = await createHarness({
      serverSettings: { providers: { claudeAgent: { enabled: true } } },
    });
    if (!reachedProvider)
      harness.sendTurn.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterValidationError({
            provider: "codex",
            operation: "sendTurn",
            issue: "The model does not exist or you do not have access to it.",
          }),
        ),
      );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("first-send"),
        threadId,
        message: {
          messageId: asMessageId("request"),
          role: "user",
          text: "Fix the build",
          attachments: [],
          skills,
        },
        runtimeMode: "approval-required",
        createdAt: date,
      }),
    );
    await harness.drain();
    if (reachedProvider)
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.makeUnsafe("turn-failed-after-start"),
          threadId,
          session: {
            threadId,
            providerName: "codex",
            status: "error",
            activeTurnId: null,
            lastError: "Quota exceeded",
            runtimeMode: "approval-required",
            updatedAt: date,
          },
          createdAt: date,
        }),
      );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.handoff.start",
        commandId: CommandId.makeUnsafe("switch-provider"),
        threadId,
        modelSelection: claude,
        runtimeMode: "approval-required",
        createdAt: date,
      }),
    );
    if (!reachedProvider) await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    await harness.drain();

    const thread = (await readHarnessThread(harness))!;
    if (reachedProvider) {
      expect(thread.handoff?.stage).toBe("pending");
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      return;
    }
    expect(thread.handoff).toBeNull();
    expect(thread.modelSelection).toEqual(claude);
    expect(thread.messages.map((message) => message.id)).toEqual(["request"]);
    expect(harness.sendTurn).toHaveBeenCalledTimes(2);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      input: "Fix the build",
      skills,
      modelSelection: claude,
    });
    const restart = harness.startSessionWithOutcome.mock.calls.at(-1)?.[1];
    expect(restart?.provider).toBe("claudeAgent");
    expect(restart?.resumeCursor).toBeUndefined();
    expect(
      (await Effect.runPromise(harness.listSessions())).map((session) => session.provider),
    ).not.toContain("codex");
  });
});
