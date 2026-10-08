import { describe, expect, it } from "vitest";

import {
  asEventId,
  asItemId,
  asThreadId,
  asTurnId,
  makeIngestionTestHarness,
  waitForThread,
  type ProviderRuntimeTestActivity,
  type ProviderRuntimeTestMessage,
} from "./ingestionHarness.testSupport.ts";

describe("ProviderRuntimeIngestion buffered output", () => {
  const createHarness = makeIngestionTestHarness();

  it("buffers Codex summary deltas into one completed reasoning activity", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const baseEvent = {
      provider: "codex" as const,
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-reasoning"),
      itemId: asItemId("reasoning-buffered-1"),
    };

    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-1"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 0,
        delta: "**Inspect",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-2"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 0,
        delta: " the protocol**\n\n<!-- -->",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "content.delta",
      eventId: asEventId("evt-buffered-reasoning-delta-3"),
      payload: {
        streamKind: "reasoning_summary_text",
        summaryIndex: 1,
        delta: "**Update the adapter**\n\n<!-- -->",
      },
    });
    harness.emit({
      ...baseEvent,
      type: "item.completed",
      eventId: asEventId("evt-buffered-reasoning-completed"),
      payload: {
        itemType: "reasoning",
        status: "completed",
        title: "Reasoning",
      },
    });

    const stableActivityId = "provider-reasoning:thread-1:reasoning-buffered-1";
    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.id === stableActivityId,
      ),
    );
    const reasoningActivities = thread.activities.filter(
      (activity: ProviderRuntimeTestActivity) => activity.id === stableActivityId,
    );

    expect(reasoningActivities).toHaveLength(1);
    expect(reasoningActivities[0]).toMatchObject({
      kind: "task.progress",
      tone: "tool",
      summary: "Reasoning trace",
      payload: {
        status: "completed",
        detail: "**Inspect the protocol**\n\n<!-- -->\n\n**Update the adapter**\n\n<!-- -->",
        data: { toolCallId: "reasoning-buffered-1" },
      },
    });
  });

  it("keeps persisted Claude reasoning terminal despite late deltas and snapshots", async () => {
    const harness = await createHarness();
    const base = {
      provider: "claudeAgent" as const,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("claude-reasoning-turn"),
      itemId: asItemId("claude-message:block-0"),
      createdAt: "2026-10-04T10:00:00.000Z",
    };
    harness.emit({
      ...base,
      type: "content.delta",
      eventId: asEventId("thinking-preview"),
      payload: { streamKind: "reasoning_text", delta: "Available thought" },
    });
    harness.emit({
      ...base,
      type: "item.completed",
      eventId: asEventId("thinking-failed"),
      createdAt: "2026-10-04T10:00:01.000Z",
      payload: { itemType: "reasoning", status: "failed", detail: "Available thought" },
    });
    harness.emit({
      ...base,
      type: "content.delta",
      eventId: asEventId("thinking-late-delta"),
      createdAt: "2026-10-04T10:00:02.000Z",
      payload: { streamKind: "reasoning_text", delta: "Must not reopen" },
    });
    harness.emit({
      ...base,
      type: "item.completed",
      eventId: asEventId("thinking-late-snapshot"),
      createdAt: "2026-10-04T10:00:03.000Z",
      payload: { itemType: "reasoning", status: "completed", detail: "Must not replace failure" },
    });
    harness.emit({
      ...base,
      type: "runtime.warning",
      eventId: asEventId("thinking-drained"),
      payload: { message: "drained" },
    });
    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "thinking-drained"),
    );
    const activities = thread.activities.filter(
      (activity) => activity.id === "provider-reasoning:thread-1:claude-message:block-0",
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      createdAt: base.createdAt,
      payload: { status: "failed", detail: "Available thought" },
    });
  });

  it("flushes buffered assistant text before session exit clears turn state", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-session-exit"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-buffered-session-exit",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered-session-exit"),
      itemId: asItemId("item-buffered-session-exit"),
      payload: {
        streamKind: "assistant_text",
        delta: "persist me before exit",
      },
    });
    await harness.drain();

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-session-exited-buffered-session-exit"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffered-session-exit" &&
          message.text === "persist me before exit" &&
          message.streaming === false,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffered-session-exit",
    );
    expect(message?.text).toBe("persist me before exit");
    expect(message?.streaming).toBe(false);
  });

  it("spills oversized buffered deltas and still finalizes full assistant text", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const oversizedText = "x".repeat(40_000);

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-buffer-spill",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        streamKind: "assistant_text",
        delta: oversizedText,
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffer-spill" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffer-spill",
    );
    expect(message?.text.length).toBe(oversizedText.length);
    expect(message?.text).toBe(oversizedText);
    expect(message?.streaming).toBe(false);
    expect(message?.textSegments).toBeUndefined();
  });

  it("keeps buffered command output when completed raw streams are empty", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-empty-stream-buffered-output"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-empty-stream-output"),
      itemId: asItemId("item-empty-stream-output"),
      payload: {
        streamKind: "command_output",
        delta: "captured through delta\n",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-empty-stream-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-empty-stream-output"),
      itemId: asItemId("item-empty-stream-output"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Ran command",
        detail: "printf buffered",
        data: {
          rawInput: { command: "printf buffered" },
          rawOutput: {
            stdout: "",
            stderr: "",
          },
        },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-empty-stream-completed"),
    );
    const activity = thread.activities.find((entry) => entry.id === "evt-empty-stream-completed");
    const payload =
      activity?.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : {};
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const rawOutput =
      data.rawOutput && typeof data.rawOutput === "object"
        ? (data.rawOutput as Record<string, unknown>)
        : {};

    expect(rawOutput).toMatchObject({
      stdout: "",
      stderr: "",
      output: "captured through delta\n",
    });
  });
});
