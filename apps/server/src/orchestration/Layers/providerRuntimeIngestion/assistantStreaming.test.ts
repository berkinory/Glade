import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { CommandId } from "@glade/contracts/core/baseSchemas";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  asEventId,
  asItemId,
  asMessageId,
  asProjectId,
  asThreadId,
  asTurnId,
  makeIngestionTestHarness,
  waitForThread,
  type ProviderRuntimeTestMessage,
} from "./ingestionHarness.testSupport.ts";

describe("ProviderRuntimeIngestion assistant streaming", () => {
  const createHarness = makeIngestionTestHarness();

  it("marks streamed assistant text segments at tool-intervention boundaries", async () => {
    const harness = await createHarness();
    const turnId = asTurnId("turn-segment-interleave");
    const itemId = asItemId("item-segment-interleave");
    const threadId = asThreadId("thread-1");
    const push = (event: ProviderRuntimeEvent) =>
      Effect.runPromise(harness.runtimeEventRepository.append(event));
    const eventId = (suffix: string) => asEventId(`evt-segment-${suffix}`);

    await push({
      type: "content.delta",
      eventId: eventId("1"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:00.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Plan: " },
    });
    await push({
      type: "content.delta",
      eventId: eventId("2"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "scan files." },
    });

    const toolItemId = asItemId("tool-segment-interleave");
    await push({
      type: "item.started",
      eventId: eventId("3"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId: toolItemId,
      payload: { itemType: "command_execution", status: "inProgress", title: "fd" },
    });
    await push({
      type: "content.delta",
      eventId: eventId("4"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:01.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Found the file: " },
    });
    await push({
      type: "content.delta",
      eventId: eventId("5"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:21.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "a.test.ts" },
    });
    await push({
      type: "item.completed",
      eventId: eventId("6"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:30.000Z",
      threadId,
      turnId,
      itemId: toolItemId,
      payload: { itemType: "command_execution", status: "completed", title: "fd" },
    });
    await push({
      type: "content.delta",
      eventId: eventId("7"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:40.000Z",
      threadId,
      turnId,
      itemId,
      payload: { streamKind: "assistant_text", delta: "Done." },
    });
    await push({
      type: "item.completed",
      eventId: eventId("8"),
      provider: "codex",
      createdAt: "2026-07-14T00:10:45.000Z",
      threadId,
      turnId,
      itemId,
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:item-segment-interleave" && message.streaming === false,
      ),
    );
    const message = thread.messages.find(
      (entry) => entry.id === "assistant:item-segment-interleave",
    );
    const toolStarted = thread.activities.find((activity) => activity.kind === "tool.started");
    expect(message?.text).toBe("Plan: scan files.Found the file: a.test.tsDone.");
    expect(
      message?.textSegments?.map(({ startedAt, endedAt, text }) => ({
        startedAt,
        endedAt,
        text,
      })),
    ).toEqual([
      {
        startedAt: "2026-07-14T00:10:00.000Z",
        endedAt: "2026-07-14T00:10:01.000Z",
        text: "Plan: scan files.",
      },
      {
        startedAt: "2026-07-14T00:10:01.000Z",
        endedAt: "2026-07-14T00:10:21.000Z",
        text: "Found the file: a.test.ts",
      },
      {
        startedAt: "2026-07-14T00:10:40.000Z",
        endedAt: "2026-07-14T00:10:45.000Z",
        text: "Done.",
      },
    ]);
    expect(message?.textSegments?.[0]?.sequence).toBeLessThan(toolStarted?.sequence ?? -1);
    expect(toolStarted?.sequence).toBeLessThan(message?.textSegments?.[1]?.sequence ?? -1);
  });

  it("does not re-emit message-sent events when the same image_generation completion replays", async () => {
    const harness = await createHarness();
    const turnId = asTurnId("turn-image-replay");
    const imagePath = "/tmp/provider-thread/replay.png";

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-replay-turn-started"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-replay-answer-delta"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("answer-replay"),
      payload: { streamKind: "assistant_text", delta: "Here you go." },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-replay-answer-complete"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("answer-replay"),
      payload: { itemType: "assistant_message", status: "completed" },
    });

    await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message) =>
          message.id === "assistant:answer-replay" &&
          message.text.includes("Here you go.") &&
          message.streaming === false,
      ),
    );

    const imageEvent = {
      type: "item.completed" as const,
      eventId: asEventId("evt-replay-image-complete"),
      provider: "codex" as const,
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("call-replay"),
      payload: {
        itemType: "image_generation",
        status: "completed",
        title: "Generated image",
        detail: imagePath,
        data: { kind: "codex.generated_image", path: imagePath, callId: "call-replay" },
      },
    };

    harness.emit(imageEvent);
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-replay-turn-completed"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      payload: { state: "completed" },
    });

    await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:answer-replay" &&
          message.text.includes(`![Generated image](${imagePath})`),
      ),
    );

    const eventCountBeforeReplay = await Effect.runPromise(
      harness.engine.getReadModel().pipe(
        Effect.map((readModel) => {
          const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
          const message = thread?.messages.find((entry) => entry.id === "assistant:answer-replay");
          return message?.text ?? "";
        }),
      ),
    );

    // Replay the same image_generation_end event with a fresh eventId (provider would use a new id even
    // for an idempotent replay). The dedup guard should prevent any further delta or complete
    // dispatches because the target message already references the image.
    harness.emit({
      ...imageEvent,
      eventId: asEventId("evt-replay-image-complete-2"),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalText = await Effect.runPromise(
      harness.engine.getReadModel().pipe(
        Effect.map((readModel) => {
          const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
          const message = thread?.messages.find((entry) => entry.id === "assistant:answer-replay");
          return message?.text ?? "";
        }),
      ),
    );

    expect(finalText).toBe(eventCountBeforeReplay);
    const occurrences = finalText.split(`![Generated image](${imagePath})`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("binds overlapping same-thread delivery modes in provider turn order", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-same-thread-buffered"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-same-thread-buffered"),
          role: "user",
          text: "buffer first",
          attachments: [],
        },
        assistantDeliveryMode: "buffered",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-same-thread-streaming"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-same-thread-streaming"),
          role: "user",
          text: "stream second",
          attachments: [],
        },
        assistantDeliveryMode: "streaming",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
    });
    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-same-thread-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-streaming"),
    });
    await harness.drain();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
      itemId: asItemId("item-same-thread-buffered"),
      payload: { streamKind: "assistant_text", delta: "first stays hidden" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-same-thread-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-streaming"),
      itemId: asItemId("item-same-thread-streaming"),
      payload: { streamKind: "assistant_text", delta: "second is live" },
    });
    await harness.drain();

    const liveThread = await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-streaming" &&
          message.streaming &&
          message.text === "second is live",
      ),
    );
    expect(
      liveThread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-completed-same-thread-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-same-thread-buffered"),
      itemId: asItemId("item-same-thread-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await waitForThread(harness.engine, (thread) =>
      thread.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-same-thread-buffered" &&
          !message.streaming &&
          message.text === "first stays hidden",
      ),
    );
  });

  it("isolates overlapping buffered and streaming turns across threads", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const secondThreadId = asThreadId("thread-delivery-buffered");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-delivery-buffered"),
        threadId: secondThreadId,
        projectId: asProjectId("project-1"),
        title: "Buffered Thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-seed-delivery-buffered"),
        threadId: secondThreadId,
        session: {
          threadId: secondThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: now,
          lastError: null,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-overlap-streaming"),
        threadId: asThreadId("thread-1"),
        message: {
          messageId: asMessageId("message-overlap-streaming"),
          role: "user",
          text: "stream this turn",
          attachments: [],
        },
        assistantDeliveryMode: "streaming",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-overlap-buffered"),
        threadId: secondThreadId,
        message: {
          messageId: asMessageId("message-overlap-buffered"),
          role: "user",
          text: "buffer this turn",
          attachments: [],
        },
        assistantDeliveryMode: "buffered",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
    });
    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
    });
    await harness.drain();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
      itemId: asItemId("item-overlap-streaming"),
      payload: { streamKind: "assistant_text", delta: "visible immediately" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-delta-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-overlap-buffered"),
      payload: { streamKind: "assistant_text", delta: "hidden until complete" },
    });
    await harness.drain();

    const streamingThread = await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-overlap-streaming" &&
            message.streaming &&
            message.text === "visible immediately",
        ),
      2_000,
      asThreadId("thread-1"),
    );
    expect(
      streamingThread.messages.find(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-streaming",
      )?.streaming,
    ).toBe(true);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const bufferedThread = readModel.threads.find((thread) => thread.id === secondThreadId);
    expect(
      bufferedThread?.messages.some(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-overlap-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });

    const completedBufferedThread = await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-overlap-buffered" &&
            !message.streaming &&
            message.text === "hidden until complete",
        ),
      2_000,
      secondThreadId,
    );
    expect(
      completedBufferedThread.messages.find(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-overlap-buffered",
      )?.streaming,
    ).toBe(false);

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      payload: { state: "completed" },
    });
    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session.activeTurnId === null,
      2_000,
      secondThreadId,
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-late-delta-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-late-overlap-buffered"),
      payload: { streamKind: "assistant_text", delta: "late but still buffered" },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-second-delta-overlap-streaming"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-overlap-streaming"),
      itemId: asItemId("item-second-overlap-streaming"),
      payload: { streamKind: "assistant_text", delta: "still streams" },
    });
    await harness.drain();

    const afterTerminalReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const afterTerminalBufferedThread = afterTerminalReadModel.threads.find(
      (thread) => thread.id === secondThreadId,
    );
    expect(
      afterTerminalBufferedThread?.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-late-overlap-buffered",
      ),
    ).toBe(false);
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-second-overlap-streaming" &&
            message.streaming &&
            message.text === "still streams",
        ),
      2_000,
      asThreadId("thread-1"),
    );

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-late-completed-overlap-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: secondThreadId,
      turnId: asTurnId("turn-overlap-buffered"),
      itemId: asItemId("item-late-overlap-buffered"),
      payload: { itemType: "assistant_message", status: "completed" },
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-late-overlap-buffered" &&
            !message.streaming &&
            message.text === "late but still buffered",
        ),
      2_000,
      secondThreadId,
    );
  });

  it("does not duplicate assistant completion when item.completed is followed by turn.completed", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-complete-dedup",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        streamKind: "assistant_text",
        delta: "done",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      payload: {
        state: "completed",
      },
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "ready" &&
        thread.session?.activeTurnId === null &&
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-complete-dedup" && !message.streaming,
        ),
    );

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const completionEvents = events.filter((event) => {
      if (event.type !== "thread.message-sent") {
        return false;
      }
      return (
        event.payload.messageId === "assistant:item-complete-dedup" &&
        event.payload.streaming === false
      );
    });
    expect(completionEvents).toHaveLength(1);
    const completionEvent = completionEvents[0] as
      | Extract<OrchestrationEvent, { type: "thread.message-sent" }>
      | undefined;
    expect(completionEvent?.payload.text).toBe("done");
  });
});
