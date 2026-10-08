import { CommandId } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  asEventId,
  asItemId,
  asThreadId,
  asTurnId,
  makeIngestionTestHarness,
  waitForThread,
  type ProviderRuntimeTestActivity,
} from "./ingestionHarness.testSupport.ts";

describe("ProviderRuntimeIngestion subagent threads", () => {
  const createHarness = makeIngestionTestHarness();

  it("creates and routes subagent runtime events into child threads", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "item.updated",
      eventId: asEventId("evt-collab-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-parent"),
      itemId: asItemId("item-collab"),
      providerRefs: { providerThreadId: "parent-provider-1" },
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-1", "parent-provider-1"],
            receiverAgents: [
              {
                threadId: "child-provider-1",
                agentNickname: "Locke",
                agentRole: "explorer",
                agentId: "agent-1",
              },
            ],
          },
        },
      },
    });

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-child-turn-started"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-child"),
      parentTurnId: asTurnId("turn-parent"),
      providerRefs: {
        providerThreadId: "child-provider-1",
        providerParentThreadId: "parent-provider-1",
        providerTurnId: "turn-child",
        parentProviderTurnId: "turn-parent",
      },
      payload: {},
    });

    const childThread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.parentThreadId === "thread-1" &&
        entry.subagentNickname === "Locke" &&
        entry.subagentRole === "explorer" &&
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-child",
      2000,
      asThreadId("subagent:thread-1:child-provider-1"),
    );

    expect(childThread.title).toBe("Locke [explorer]");
    expect(childThread.creationSource).toBe("provider_native");
    expect(childThread.sourceThreadId).toBe("thread-1");
    expect(childThread.sourceTurnId).toBe("turn-parent");

    const parentThread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) =>
          activity.id === "evt-collab-updated" && activity.kind === "tool.updated",
      ),
    );
    expect(
      parentThread.activities.some((activity) => activity.id === "evt-child-turn-started"),
    ).toBe(false);
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    expect(readModel.threads.filter((thread) => thread.parentThreadId === "thread-1")).toHaveLength(
      1,
    );
  });

  it("keeps ingesting after a subagent child thread is deleted instead of re-creating it", async () => {
    const harness = await createHarness();
    const childThreadId = asThreadId("subagent:thread-1:child-provider-deleted");
    const collabEvent = {
      type: "item.updated",
      provider: "codex",
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-deleted-child"),
      itemId: asItemId("item-collab-deleted"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-deleted"],
          },
        },
      },
    } as const;

    harness.emit({
      ...collabEvent,
      eventId: asEventId("evt-collab-deleted-child-1"),
      createdAt: new Date().toISOString(),
    });
    await harness.drain();
    await waitForThread(
      harness.engine,
      (entry) => entry.parentThreadId === "thread-1",
      2000,
      childThreadId,
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-delete-native-child"),
        threadId: childThreadId,
      }),
    );

    // A later provider event for the same child must not try to resurrect the tombstoned thread:
    // `thread.create` would be rejected, and the rejection is stored against a deterministic command
    // id, so every later replay of this event would fail on the stored rejection.
    harness.emit({
      ...collabEvent,
      eventId: asEventId("evt-collab-deleted-child-2"),
      createdAt: new Date().toISOString(),
    });
    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const child = readModel.threads.find((thread) => thread.id === childThreadId);
    expect(child?.deletedAt).not.toBeNull();

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-after-deleted-child"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      payload: { message: "still ingesting" },
    });
    await harness.drain();
    const parent = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.id === "evt-after-deleted-child",
      ),
    );
    expect(parent.id).toBe("thread-1");
  });

  it("caps native child materialization per parent turn and deduplicates replay", async () => {
    const harness = await createHarness();
    const receiverThreadIds = Array.from({ length: 22 }, (_, index) => `native-child-${index}`);
    const event = {
      type: "item.updated",
      eventId: asEventId("evt-collab-overflow"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-native-budget"),
      itemId: asItemId("item-collab-overflow"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds,
          },
        },
      },
    } as const;

    harness.emit(event);
    await harness.drain();
    harness.emit(event);
    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const nativeChildren = readModel.threads.filter(
      (thread) =>
        thread.parentThreadId === "thread-1" && thread.sourceTurnId === "turn-native-budget",
    );
    expect(nativeChildren).toHaveLength(20);
    expect(
      nativeChildren.every(
        (thread) =>
          thread.creationSource === "provider_native" &&
          thread.sourceThreadId === "thread-1" &&
          thread.gatewayOperationId === null,
      ),
    ).toBe(true);
    const parent = readModel.threads.find((thread) => thread.id === "thread-1");
    expect(
      parent?.activities.filter((activity) => activity.kind === "subagent.materialization.capped"),
    ).toHaveLength(1);
  });
});
