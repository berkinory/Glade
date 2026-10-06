import { CheckpointRef, MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic.rows";
import { buildTurnDiffSummaryByAssistantMessageId } from "./MessagesTimeline.logic.rowTypes";
import { makeTimelineBaseProps } from "./MessagesTimeline.testSetup";

describe("MessagesTimeline", () => {
  it("keeps edit available while an assistant turn is running", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        isWorking
        activeTurnInProgress
        activeTurnId={TurnId.makeUnsafe("turn-user-running")}
        timelineEntries={[
          {
            id: "entry-user-running",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-user-running"),
              role: "user",
              text: "change this while it runs",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        onEditUserMessage={() => true}
        editableUserMessageId={MessageId.makeUnsafe("message-user-running")}
      />,
    );

    const editButtonMarkup = markup.match(/<button[^>]*aria-label="Edit message"[^>]*>/)?.[0] ?? "";
    expect(markup).toContain('aria-label="Edit message"');
    expect(editButtonMarkup).not.toContain('disabled=""');
    expect(markup).not.toContain('title="Edit message"');
  });

  it("renders assistant selection chips from hidden prompt markup when attachments are missing", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        timelineEntries={[
          {
            id: "entry-user-selection-fallback",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-user-selection-fallback"),
              role: "user",
              text: [
                "please use this",
                "",
                "<assistant_selection>",
                "- assistant message assistant-1:",
                "  selected line from assistant",
                "</assistant_selection>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("please use this");
    expect(markup).toContain("1 selection");
    expect(markup).not.toContain("&lt;assistant_selection&gt;");
  });
});

it("preserves separate background replies, clocks and checkpoints without user messages", () => {
  const makeMessage = (id: string, turn: string, minute: string) => ({
    id: MessageId.makeUnsafe(id),
    role: "assistant" as const,
    turnId: TurnId.makeUnsafe(turn),
    text: id,
    streaming: false,
    createdAt: `2026-10-04T10:${minute}:10.000Z`,
    completedAt: `2026-10-04T10:${minute}:20.000Z`,
  });
  const messages = [
    makeMessage("first", "foreground", "00"),
    makeMessage("second", "wake-a", "05"),
    makeMessage("third", "wake-b", "10"),
  ];
  const summaries = messages.map((message, index) => ({
    turnId: message.turnId,
    completedAt: message.completedAt,
    files: [{ path: `${message.id}.ts` }],
    checkpointRef: CheckpointRef.makeUnsafe(`checkpoint-${index}`),
    checkpointTurnCount: index + 1,
  }));
  const byMessage = buildTurnDiffSummaryByAssistantMessageId({
    messages,
    turnDiffSummaries: summaries,
  });
  const rows = deriveMessagesTimelineRows({
    timelineEntries: messages.flatMap((message, index) => [
      ...(index
        ? [
            {
              id: `boundary-${index}`,
              kind: "work" as const,
              createdAt: message.createdAt.replace(":10.", ":00."),
              entry: {
                id: `boundary-${index}`,
                createdAt: message.createdAt.replace(":10.", ":00."),
                label: "Subagent reply",
                tone: "info" as const,
                activityKind: "response.started",
                turnId: message.turnId,
              },
            },
          ]
        : []),
      { id: message.id, kind: "message" as const, createdAt: message.createdAt, message },
    ]),
    isWorking: false,
    activeTurnInProgress: true,
    activeTurnId: messages[2]!.turnId,
    worktreeSetup: null,
    worktreeSetupOpen: false,
    turnDiffSummaryByAssistantMessageId: byMessage,
  });
  const replies = rows.filter((row) => row.kind === "message");
  expect(replies.map((row) => row.message.id)).toEqual(["first", "second", "third"]);
  expect(replies.every((row) => row.showAssistantCopyButton)).toBe(true);
  expect(replies.map((row) => row.assistantCopyStreaming)).toEqual([false, false, true]);
  expect(replies.map((row) => row.assistantTurnDiffSummary?.checkpointTurnCount)).toEqual([
    1, 2, 3,
  ]);
  expect(replies[1]!.durationStart).toBe("2026-10-04T10:05:00.000Z");
  expect(replies[2]!.durationStart).toBe("2026-10-04T10:10:00.000Z");
});
