import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { CommandId } from "@glade/contracts/core/baseSchemas";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  PROVIDER_RUNTIME_INGESTION_CONSUMER,
  type PersistedProviderRuntimeEvent,
} from "../../../persistence/Services/ProviderRuntimeEvents.ts";
import { selectProviderRuntimeJournalStream } from "../ProviderRuntimeIngestion.ts";
import {
  asEventId,
  asItemId,
  asProjectId,
  asThreadId,
  asTurnId,
  makeIngestionTestHarness,
  waitForThread,
  type ProviderRuntimeTestActivity,
} from "./ingestionHarness.testSupport.ts";

describe("ProviderRuntimeIngestion journal replay", () => {
  const createHarness = makeIngestionTestHarness();

  it("uses an already-persisted runtime stream without appending the event again", async () => {
    const event: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-already-persisted-stream"),
      provider: "codex",
      createdAt: "2026-08-07T00:00:00.000Z",
      threadId: asThreadId("thread-1"),
      payload: { message: "already durable" },
    };
    const persisted = { sequence: 42, event };
    let appendCalls = 0;

    const selected = await Effect.runPromise(
      Stream.runCollect(
        selectProviderRuntimeJournalStream({
          streamEvents: Stream.succeed(event),
          streamPersistedEvents: Stream.succeed(persisted),
          append: (candidate) =>
            Effect.sync(() => {
              appendCalls += 1;
              return { sequence: 43, event: candidate };
            }),
        }),
      ).pipe(Effect.map((events) => Array.from(events))),
    );

    expect(selected).toEqual([persisted]);
    expect(appendCalls).toBe(0);
  });

  it("replays output persisted before subscription without duplicate acceptance", async () => {
    const harness = await createHarness({ startIngestion: false });
    const event: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-runtime-journal-before-subscribe"),
      provider: "codex",
      createdAt: "2026-07-14T00:00:00.000Z",
      threadId: asThreadId("thread-1"),
      payload: {
        message: "Recovered durable provider output",
      },
    };

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(
          `provider:${event.eventId}:thread-activity-append:thread-1:${event.eventId}`,
        ),
        threadId: asThreadId("thread-1"),
        activity: {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary: "Runtime warning",
          payload: {
            message: "Recovered durable provider output",
            detail: "Recovered durable provider output",
          },
          turnId: null,
        },
        createdAt: event.createdAt,
      }),
    );
    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(event));

    await harness.startIngestion();
    await waitForThread(harness.engine, (thread) =>
      thread.activities.some((activity) => activity.id === event.eventId),
    );
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(persisted.sequence);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const recoveredActivities = readModel.threads
      .find((thread) => thread.id === asThreadId("thread-1"))
      ?.activities.filter((activity) => activity.id === event.eventId);
    expect(recoveredActivities).toHaveLength(1);
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(persisted.sequence);
  });

  it("quarantines a previously rejected command without blocking later assistant output", async () => {
    const harness = await createHarness({ startIngestion: false });
    const threadId = asThreadId("thread-1");
    const lateThreadId = asThreadId("thread-2");
    const turnId = asTurnId("turn-after-rejected-command");
    const itemId = asItemId("assistant-after-rejected-command");
    const rejectedEvent: ProviderRuntimeEvent = {
      type: "runtime.warning",
      eventId: asEventId("evt-previously-rejected"),
      provider: "codex",
      createdAt: "2026-07-14T00:00:00.000Z",
      threadId: lateThreadId,
      payload: { message: "Warning for a rejected command" },
    };
    const rejectedCommandId = CommandId.makeUnsafe(
      `provider:${rejectedEvent.eventId}:thread-activity-append:${lateThreadId}:runtime.warning:${rejectedEvent.eventId}`,
    );

    // Model a durable rejection: the exact command this event replays into was already rejected by an
    // invariant (thread-2 did not exist yet when it was first dispatched), so every replay raises
    // PreviouslyRejected — retrying the journal row can never succeed.
    await expect(
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.activity.append",
          commandId: rejectedCommandId,
          threadId: lateThreadId,
          activity: {
            id: rejectedEvent.eventId,
            createdAt: rejectedEvent.createdAt,
            tone: "info",
            kind: "runtime.warning",
            summary: "Runtime warning",
            payload: {
              message: "Warning for a rejected command",
              detail: "Warning for a rejected command",
            },
            turnId: null,
          },
          createdAt: rejectedEvent.createdAt,
        }),
      ),
    ).rejects.toThrow();

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-2-create"),
        threadId: lateThreadId,
        projectId: asProjectId("project-1"),
        title: "Late thread",
        modelSelection: {
          provider: "codex",
          model: "cursor-default",
        },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const rejectedRow = await Effect.runPromise(
      harness.runtimeEventRepository.append(rejectedEvent),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "turn.started",
        eventId: asEventId("evt-turn-started-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:00.500Z",
        threadId,
        turnId,
        payload: {},
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "content.delta",
        eventId: asEventId("evt-assistant-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:01.000Z",
        threadId,
        turnId,
        itemId,
        payload: {
          streamKind: "assistant_text",
          delta: "The journal kept moving.",
        },
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-assistant-complete-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:02.000Z",
        threadId,
        turnId,
        itemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    const terminalRow = await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "turn.completed",
        eventId: asEventId("evt-turn-complete-after-rejected-command"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:03.000Z",
        threadId,
        turnId,
        payload: { state: "completed" },
      }),
    );

    await harness.startIngestion();
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === `assistant:${itemId}` &&
          message.text === "The journal kept moving." &&
          message.streaming === false,
      ),
    );
    expect(thread.messages.find((message) => message.id === `assistant:${itemId}`)?.text).toBe(
      "The journal kept moving.",
    );
    expect(thread.latestTurn).toMatchObject({ turnId, state: "completed" });
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      ),
    ).toBe(terminalRow.sequence);
    expect(rejectedRow.sequence).toBeLessThan(terminalRow.sequence);
  });

  it("rebuilds accepted buffered output before a terminal event", async () => {
    const harness = await createHarness({ startIngestion: false });
    const turnId = asTurnId("turn-buffered-restart");
    const itemId = asItemId("item-buffered-restart");
    const bufferedEvent: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: asEventId("evt-buffered-before-restart"),
      provider: "codex",
      createdAt: "2026-07-14T00:01:00.000Z",
      threadId: asThreadId("thread-1"),
      turnId,
      itemId,
      payload: {
        streamKind: "assistant_text",
        delta: "buffered before restart",
      },
    };
    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(bufferedEvent));
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: persisted.sequence,
          updatedAt: "2026-07-14T00:01:01.000Z",
        }),
      ),
    ).toBe(true);

    await harness.startIngestion();
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-buffered-after-restart-complete"),
        provider: "codex",
        createdAt: "2026-07-14T00:01:02.000Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    await harness.drain();

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message) =>
          message.id === "assistant:item-buffered-restart" &&
          message.text === "buffered before restart" &&
          message.streaming === false,
      ),
    );
    expect(
      thread.messages.find((message) => message.id === "assistant:item-buffered-restart")?.text,
    ).toBe("buffered before restart");
  });

  it("starts when an accepted open-turn row can no longer replay its stored command", async () => {
    const harness = await createHarness({ startIngestion: false });
    const eventId = asEventId("evt-open-turn-unreplayable");
    const turnId = asTurnId("turn-open-turn-unreplayable");
    const bufferedItemId = asItemId("item-after-unreplayable-open-turn");
    const event: ProviderRuntimeEvent = {
      type: "item.updated",
      eventId,
      provider: "codex",
      createdAt: "2026-07-14T00:03:00.000Z",
      threadId: asThreadId("thread-1"),
      turnId,
      itemId: asItemId("item-collab-unreplayable"),
      payload: {
        itemType: "collab_agent_tool_call",
        title: "Task",
        data: {
          item: {
            type: "collabAgentToolCall",
            receiverThreadIds: ["child-provider-unreplayable"],
          },
        },
      },
    };

    // Bind the child-create command id to a rejected command, the way a build that reshaped provider
    // command ids leaves receipts the next build can never reuse. The startup rebuild runs on the
    // server's boot path, so a row it can never replay must degrade to a warning, not a crash loop.
    const rejected = await Effect.runPromise(
      Effect.result(
        harness.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(
            `provider:${eventId}:subagent-thread-create:subagent:thread-1:child-provider-unreplayable`,
          ),
          threadId: asThreadId("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Duplicate",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: event.createdAt,
        }),
      ),
    );
    expect(rejected._tag).toBe("Failure");

    const persisted = await Effect.runPromise(harness.runtimeEventRepository.append(event));
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: persisted.sequence,
          updatedAt: event.createdAt,
        }),
      ),
    ).toBe(true);

    const bufferedRow = await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "content.delta",
        eventId: asEventId("evt-buffered-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:00.500Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId: bufferedItemId,
        payload: {
          streamKind: "assistant_text",
          delta: "Replay continued after the failed event.",
        },
      }),
    );
    expect(
      await Effect.runPromise(
        harness.runtimeEventRepository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: bufferedRow.sequence,
          updatedAt: "2026-07-14T00:03:00.500Z",
        }),
      ),
    ).toBe(true);

    await harness.startIngestion();

    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "item.completed",
        eventId: asEventId("evt-complete-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:01.000Z",
        threadId: asThreadId("thread-1"),
        turnId,
        itemId: bufferedItemId,
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    await Effect.runPromise(
      harness.runtimeEventRepository.append({
        type: "runtime.warning",
        eventId: asEventId("evt-after-unreplayable-open-turn"),
        provider: "codex",
        createdAt: "2026-07-14T00:03:02.000Z",
        threadId: asThreadId("thread-1"),
        payload: { message: "still ingesting" },
      }),
    );
    await harness.drain();
    const parent = await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) =>
            activity.id === "evt-after-unreplayable-open-turn",
        ) &&
        entry.messages.some(
          (message) =>
            message.id === `assistant:${bufferedItemId}` &&
            message.text === "Replay continued after the failed event.",
        ),
    );
    expect(parent.id).toBe("thread-1");
  });

  it("continues processing runtime events after a single event handler failure", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-invalid-delta"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-invalid"),
      itemId: asItemId("item-invalid"),
      payload: {
        streamKind: "assistant_text",
        delta: undefined,
      },
    } as unknown as ProviderRuntimeEvent);

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-after-failure"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-after-failure"),
      payload: {
        message: "runtime still processed",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-after-failure" &&
        entry.session?.lastError === "runtime still processed",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime still processed");
  });

  it("acknowledges a burst of live journal notifications in pages, not one per event", async () => {
    const harness = await createHarness({ persistedStream: true });
    const { sql } = harness;
    await Effect.runPromise(
      sql`CREATE TABLE cursor_acks (from_sequence INTEGER, to_sequence INTEGER)`,
    );
    await Effect.runPromise(sql`
      CREATE TRIGGER capture_cursor_acks AFTER UPDATE ON provider_runtime_event_consumers
      BEGIN
        INSERT INTO cursor_acks VALUES (OLD.last_acked_sequence, NEW.last_acked_sequence);
      END
    `);
    const rows: PersistedProviderRuntimeEvent[] = [];
    for (let index = 0; index < 32; index += 1) {
      rows.push(
        await Effect.runPromise(
          harness.runtimeEventRepository.append({
            type: "runtime.warning",
            eventId: asEventId(`live-burst-${index}`),
            provider: "codex",
            threadId: asThreadId("thread-1"),
            createdAt: "2026-09-10T00:00:00.000Z",
            payload: { message: "burst" },
          }),
        ),
      );
    }

    for (const row of rows) harness.emitPersisted(row);
    const target = rows.at(-1)!.sequence;
    const deadline = Date.now() + 5_000;
    while (
      (await Effect.runPromise(
        harness.runtimeEventRepository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
      )) < target
    ) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the live drain");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const acks = await Effect.runPromise(
      sql<{ readonly fromSequence: number; readonly toSequence: number }>`
        SELECT from_sequence AS "fromSequence", to_sequence AS "toSequence" FROM cursor_acks
        ORDER BY to_sequence ASC
      `,
    );
    expect(acks.at(-1)?.toSequence).toBe(target);

    expect(acks.length).toBeLessThan(rows.length);
    expect(acks.length).toBeLessThanOrEqual(4);
  });
});
