import { describe, it, expect, vi } from "vitest";
import { Effect, Option, Duration } from "effect";
import { CommandId, ThreadId, ProjectId } from "@glade/contracts/core/baseSchemas";

import { resolveProviderAttachmentPath } from "../../provider/core/providerAttachmentPaths.ts";
import path from "node:path";
import { type CheckpointStoreShape } from "../../checkpointing/Services/CheckpointStore.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from "../../provider/core/Errors.ts";
import { makeReactorTestHarness, asMessageId, waitFor, asTurnId } from "./reactorTestFixtures";

describe("Provider reactor turnDispatch", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();

  it("names a generic thread from a meaningful message after punctuation-only history", async () => {
    const harness = await createHarness();
    const threadId = ThreadId.makeUnsafe("thread-1");
    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("generic-title"),
        threadId,
        title: "New thread",
      }),
    );
    await harness.seedUserMessage({
      threadId,
      messageId: asMessageId("punctuation-message"),
      text: ".",
      createdAt: createdAt,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("meaningful-message"),
        threadId,
        message: {
          messageId: asMessageId("meaningful-message"),
          role: "user",
          text: "Fix the sidebar",
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();
    await waitFor(
      async () => (await readHarnessThread(harness))?.title === "Generated conversation title",
    );
    expect(harness.generateTitle).toHaveBeenCalledOnce();
  });

  it("dispatches managed attachments from their repository object paths", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "att_v2_aa000000000000000000000000000000",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const storagePath = await harness.stageAttachment(imageAttachment);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-managed-object-path-generic-title"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "New thread",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-managed-object-path"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("message-managed-object-path"),
          role: "user",
          text: "Inspect this image",
          attachments: [imageAttachment],
        },
        runtimeMode: "approval-required",

        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const sentAttachment = harness.sendTurn.mock.calls[0]?.[0].attachments?.[0];
    expect(sentAttachment).toMatchObject(imageAttachment);
    expect(
      sentAttachment &&
        resolveProviderAttachmentPath({
          attachmentsDir: path.join(harness.stateDir, "attachments"),
          attachment: sentAttachment,
        }),
    ).toBe(storagePath);
  });

  it("rejects a direct native child turn without starting a separate provider session", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const parentId = ThreadId.makeUnsafe("thread-1");
    const childId = ThreadId.makeUnsafe("subagent:thread-1:native-worker");
    const parent = await readHarnessThread(harness);
    if (!parent) throw new Error("Expected parent thread");
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("create-native-child"),
        threadId: childId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Native worker",
        modelSelection: parent.modelSelection,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        parentThreadId: parentId,
        creationSource: "provider_native",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("direct-native-child-turn"),
        threadId: childId,
        message: {
          messageId: asMessageId("direct-child-message"),
          role: "user",
          text: "Change the task",
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(async () =>
      Boolean(
        (await readHarnessThread(harness, childId))?.activities.some(
          (activity) =>
            activity.kind === "provider.turn.start.failed" &&
            JSON.stringify(activity.payload).includes(
              "Send follow-up instructions to the main conversation",
            ),
        ),
      ),
    );
    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect(harness.steerTurn).not.toHaveBeenCalled();
    expect((await readHarnessThread(harness))?.session).toBeNull();
  });

  it("reacts to thread.turn.start by ensuring session and sending provider turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.listSessions.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-1"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },

        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.makeUnsafe("thread-1"));
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });
    const providerInput = harness.sendTurn.mock.calls[0]?.[0].input;
    expect(providerInput).toBe("hello reactor");

    const thread = await readHarnessThread(harness);
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
    // One scan rechecks the provider's live-turn race before dispatch; the session ensure then performs
    // the only full lookup needed for startup.
    expect(harness.listSessions).toHaveBeenCalledTimes(2);
  });

  it("waits for the message-start checkpoint before sending the provider turn", async () => {
    let releaseCapture: (() => void) | undefined;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const captureCheckpoint = vi.fn<CheckpointStoreShape["captureCheckpoint"]>(() =>
      Effect.promise(() => captureGate),
    );
    const harness = await createHarness({
      checkpointStore: {
        isGitRepository: vi.fn<CheckpointStoreShape["isGitRepository"]>(() => Effect.succeed(true)),
        captureCheckpoint,
      },
    });
    const now = new Date().toISOString();

    const dispatch = Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-slow-checkpoint"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-slow-checkpoint"),
          role: "user",
          text: "hello despite slow git",
          attachments: [],
        },

        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => captureCheckpoint.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(harness.sendTurn.mock.calls.length).toBe(0);

    releaseCapture?.();
    await dispatch;
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(captureCheckpoint.mock.calls.length).toBe(1);
    expect(captureCheckpoint.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/tmp/provider-project",
    });
    expect(captureCheckpoint.mock.calls[0]?.[0].checkpointRef).toContain("/message-start/");
  });

  it("marks the thread session errored when normal turn start fails", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.sendTurn.mockImplementationOnce(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "turn/start",
          detail: "turn start failed",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-fails"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-start-fails"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },

        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");

    const thread = await readHarnessThread(harness);
    expect(thread?.session?.status).toBe("error");
    expect(thread?.session?.activeTurnId).toBeNull();
    expect(thread?.session?.lastError).toBe(
      "Provider adapter request failed (codex) for turn/start: turn start failed",
    );
    expect(
      thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed"),
    ).toBe(true);
    await waitFor(async () => {
      const delivery = await Effect.runPromise(
        harness.deliveryRepository.firstBlockingDeliveryForThread({
          consumerName: "provider-command-reactor.v1",
          threadId: "thread-1",
        }),
      );
      return Option.isSome(delivery) && delivery.value.state === "uncertain";
    });
    const deliveryBlocker = await Effect.runPromise(
      harness.deliveryRepository.firstBlockingDeliveryForThread({
        consumerName: "provider-command-reactor.v1",
        threadId: "thread-1",
      }),
    );
    expect(deliveryBlocker.pipe(Option.getOrThrow)).toMatchObject({
      state: "uncertain",
      attemptCount: 1,
    });
  });

  it("surfaces a timed-out fresh turn start instead of leaving the thread starting", async () => {
    const harness = await createHarness({
      commandEventTimeout: Duration.millis(25),
    });
    const now = new Date().toISOString();
    harness.startSession.mockImplementationOnce(() => Effect.never);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-times-out"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-start-times-out"),
          role: "user",
          text: "hello stalled provider",
          attachments: [],
        },

        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");
    const thread = await readHarnessThread(harness);
    expect(thread?.session?.activeTurnId).toBeNull();
    expect(thread?.session?.lastError).toContain("did not respond within 25ms");
    await waitFor(async () =>
      Boolean(
        (await readHarnessThread(harness))?.activities.some(
          (activity) =>
            activity.kind === "provider.turn.start.failed" &&
            (activity.payload as Record<string, unknown> | null)?.settlementStatus === "uncertain",
        ),
      ),
    );
  });

  for (const interveningEvent of [false, true]) {
    it(`restores only its own optimistic state after a busy Claude rejection (concurrent event: ${interveningEvent})`, async () => {
      const harness = await createHarness({
        threadModelSelection: { provider: "claudeAgent", model: "claude-fable-5-1" },
      });
      const threadId = ThreadId.makeUnsafe("thread-1");
      const createdAt = new Date().toISOString();
      const send = (
        id: string,
        runtimeMode: "approval-required" | "full-access" = "approval-required",
      ) =>
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(id),
          threadId,
          message: { messageId: asMessageId(id), role: "user", text: "continue", attachments: [] },

          runtimeMode,
          createdAt,
        });
      await Effect.runPromise(send("bootstrap-busy"));
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      await harness.drain();
      const prior = (await Effect.runPromise(harness.engine.getReadModel())).threads[0]!.session!;
      harness.sendTurn.mockClear();
      harness.startSession.mockImplementationOnce(() =>
        Effect.gen(function* () {
          if (interveningEvent) {
            yield* harness.engine
              .dispatch({
                type: "thread.session.set",
                commandId: CommandId.makeUnsafe("late-runtime-event"),
                threadId,
                session: {
                  ...prior,
                  status: "running",
                  activeTurnId: asTurnId("late-turn"),
                  updatedAt: "2099-01-01T00:00:00.000Z",
                },
                createdAt: "2099-01-01T00:00:00.000Z",
              })
              .pipe(Effect.orDie);
          }
          return yield* new ProviderAdapterValidationError({
            provider: "claudeAgent",
            operation: "session/reconfigure",
            issue: "Background work is active",
          });
        }),
      );
      await Effect.runPromise(send("rejected-busy", "full-access"));
      await harness.drain();
      const after = (await Effect.runPromise(harness.engine.getReadModel())).threads[0]!.session!;
      expect(after).toMatchObject(
        interveningEvent
          ? { status: "running", activeTurnId: "late-turn" }
          : { status: "ready", activeTurnId: null, runtimeMode: prior.runtimeMode },
      );
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(harness.stopSession).not.toHaveBeenCalled();
    });
  }
});
