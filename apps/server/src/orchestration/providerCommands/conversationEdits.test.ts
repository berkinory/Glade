import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";

import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import path from "node:path";
import { attachmentRelativePath } from "../../attachments/attachmentStore.ts";
import fs from "node:fs";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ProviderAdapterRequestError } from "../../provider/core/Errors.ts";
import {
  makeReactorTestHarness,
  asMessageId,
  asTurnId,
  waitFor,
  asEventId,
} from "./reactorTestFixtures";

describe("Provider reactor conversationEdits", () => {
  const { createHarness, seedRollbackTarget, readHarnessThread, dispatchHarnessUserTurn } =
    makeReactorTestHarness();

  it("interrupts the active provider turn before rolling back an edited message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-active"),
      turnId: asTurnId("turn-rollback-active"),
      createdAt: now,
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-rollback"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-active-edit"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.conversation.rollback",
        commandId: CommandId.makeUnsafe("cmd-conversation-rollback-active"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-active"),
        numTurns: 1,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.rollbackConversation.mock.calls.length === 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: asTurnId("turn-active-edit"),
    });
    expect(harness.rollbackConversation.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.makeUnsafe("thread-1"),
      numTurns: 1,
    });
  });

  it("interrupts and rewinds the native conversation before resending an edited latest message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "edit-image-1",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 42,
    };
    const skill = {
      name: "docs",
      path: "/tmp/docs-skill",
    };
    const mention = {
      name: "README.md",
      path: "/tmp/project/README.md",
    };

    await harness.stageAttachment(imageAttachment);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-original-turn-start-for-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("user-message-edit"),
          role: "user",
          text: "old prompt",
          attachments: [imageAttachment],
          skills: [skill],
          mentions: [mention],
        },
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    harness.sendTurn.mockClear();
    harness.startSession.mockClear();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-active-edit-resend"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-and-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-edit"),
        text: "edited prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.stopRuntimeSession).not.toHaveBeenCalled();
    expect(harness.interruptTurn).toHaveBeenCalledOnce();
    expect(harness.rollbackConversation).toHaveBeenCalledOnce();
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "edited prompt",
      attachments: [imageAttachment],
      skills: [skill],
      mentions: [mention],
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));
    expect(thread?.messages.map((message) => message.text)).toEqual(["edited prompt"]);
    expect(thread?.messages[0]).toMatchObject({
      attachments: [imageAttachment],
      skills: [skill],
      mentions: [mention],
    });
  });

  it("keeps queued-message edits queued while an active provider turn continues", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.setRuntimeSessionTurnState({
      threadId: "thread-1",
      status: "running",
      activeTurnId: asTurnId("turn-running-edit-queued"),
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-edit-queued"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-running-edit-queued"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-queued-before-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-queued-before-edit"),
          role: "user",
          text: "queued prompt",
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();
    harness.stopRuntimeSession.mockClear();
    harness.rollbackConversation.mockClear();
    harness.sendTurn.mockClear();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-queued-message"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("msg-queued-before-edit"),
        text: "edited queued prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    expect(harness.stopRuntimeSession).not.toHaveBeenCalled();
    expect(harness.rollbackConversation).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    harness.setRuntimeSessionTurnState({ threadId: "thread-1", status: "ready" });
    await harness.emitRuntimeEvent({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-edited-queue"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-running-edit-queued"),
      payload: {
        state: "completed",
      },
      providerRefs: {},
    } as ProviderRuntimeEvent);

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      input: "edited queued prompt",
    });
  });

  it("preserves image attachment files while rolling back an edit resend", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const imageAttachment = {
      type: "image" as const,
      id: "thread-1-12345678-1234-1234-1234-123456789abc",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 4,
    };
    const attachmentPath = path.join(
      harness.stateDir,
      "attachments",
      attachmentRelativePath(imageAttachment),
    );
    fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
    fs.writeFileSync(attachmentPath, Buffer.from([1, 2, 3, 4]));
    await harness.stageAttachment(imageAttachment);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-original-image-edit"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-image-edit"),
          role: "user",
          text: "old image prompt",
          attachments: [imageAttachment],
        },
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(
      async () =>
        (await readHarnessThread(harness))?.messages.find(
          (message) => message.id === asMessageId("msg-image-edit"),
        )?.turnId != null,
    );
    const imageEditTurnId = (await readHarnessThread(harness))?.messages.find(
      (message) => message.id === asMessageId("msg-image-edit"),
    )?.turnId;
    if (!imageEditTurnId) throw new Error("Expected the image prompt to bind to a turn.");
    harness.sendTurn.mockClear();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-image-edit-assistant-complete"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("assistant-image-edit"),
        turnId: imageEditTurnId,
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-image-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("msg-image-edit"),
        text: "edited image prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(fs.existsSync(attachmentPath)).toBe(true);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: "edited image prompt",
      attachments: [imageAttachment],
    });
  });

  it("restores the previous filesystem checkpoint before resending a completed edit", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.isGitRepository.mockImplementationOnce(() => Effect.succeed(true));

    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-checkpoint-edit"),
      turnId: asTurnId("turn-checkpoint-edit"),
      createdAt: now,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.makeUnsafe("cmd-checkpoint-edit-complete"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: asTurnId("turn-checkpoint-edit"),
        completedAt: now,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe("thread-1"), 1),
        status: "ready",
        files: [],
        assistantMessageId: asMessageId("assistant-user-message-checkpoint-edit"),
        checkpointTurnCount: 1,
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-edit-checkpoint-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-checkpoint-edit"),
        text: "edited checkpoint prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.restoreScopedCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/provider-project",
        turns: [
          expect.objectContaining({
            fallbackBeforeCheckpointRef: checkpointRefForThreadTurn(
              ThreadId.makeUnsafe("thread-1"),
              0,
            ),
          }),
        ],
        confirmation: { fingerprint: "empty", overwritePaths: [] },
      }),
    );
  });

  it("rewinds a stopped conversation before resending an edited message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-restart-edit"),
      turnId: asTurnId("turn-restart-edit"),
      createdAt: now,
    });
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-restart-edit-resend"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-restart-edit"),
        text: "edited after stop",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.rollbackConversation).toHaveBeenCalledWith({
      threadId: ThreadId.makeUnsafe("thread-1"),
      numTurns: 1,
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: "edited after stop",
    });
    expect((await readHarnessThread(harness))?.messages.map((message) => message.text)).toEqual([
      "edited after stop",
    ]);
  });

  it("keeps a textless stopped turn editable after its active turn id clears", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const threadId = ThreadId.makeUnsafe("thread-1");
    const messageId = asMessageId("user-textless-turn");
    await dispatchHarnessUserTurn(harness, {
      messageId,
      text: "original prompt",
      createdAt: now,
    });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(
      async () =>
        (await readHarnessThread(harness))?.messages.find((message) => message.id === messageId)
          ?.turnId != null,
    );
    const startedTurnId = (await readHarnessThread(harness))?.messages.find(
      (message) => message.id === messageId,
    )?.turnId;
    expect(startedTurnId).toBeTruthy();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-textless-turn-stopped"),
        threadId,
        session: {
          threadId,
          status: "stopped",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-textless-turn-edit"),
        threadId,
        messageId,
        text: "edited prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect((await readHarnessThread(harness))?.messages.map((message) => message.text)).toEqual([
      "edited prompt",
    ]);
  });

  it("preserves the transcript when the provider cannot recover the native edit boundary", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    await seedRollbackTarget(harness, {
      messageId: asMessageId("user-message-stale"),
      turnId: asTurnId("turn-rollback-stale"),
      createdAt: now,
    });
    harness.rollbackConversation.mockImplementationOnce(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "thread/rollback",
          detail: "thread/resume failed: no rollout found for thread id 019db5ad",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.edit-and-resend",
        commandId: CommandId.makeUnsafe("cmd-conversation-rollback-stale-resume"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: asMessageId("user-message-stale"),
        text: "corrected prompt",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => (await readHarnessThread(harness))?.session?.status === "error");
    expect(harness.clearSessionResumeCursor).not.toHaveBeenCalled();
    expect(harness.stopSession).not.toHaveBeenCalled();
    expect(
      (await readHarnessThread(harness))?.messages.some(
        (message) => message.id === "user-message-stale",
      ),
    ).toBe(true);
  });
});
