import { CheckpointRef, MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkLogEntry } from "../../workLog.types";

import { makeTimelineBaseProps } from "./MessagesTimeline.testSetup";

describe("MessagesTimeline tool rows", () => {
  it("hides raw `ToolName: {json}` argument details behind the humanized heading", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const baseProps = makeTimelineBaseProps();

    const renderSingleToolRow = (entry: WorkLogEntry) =>
      renderToStaticMarkup(
        <MessagesTimeline
          {...baseProps}
          timelineEntries={[
            {
              id: `entry-${entry.id}`,
              kind: "work",
              createdAt: "2026-03-17T19:12:28.000Z",
              entry,
            },
          ]}
        />,
      );

    const readThreadMarkup = renderSingleToolRow({
      id: "work-glade-read-thread-args",
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "MCP tool call",
      tone: "tool",
      itemType: "mcp_tool_call",
      toolName: "mcp__glade__glade_read_thread",
      detail: 'mcp__glade__glade_read_thread: {"threadId":"c357d8c5-b4c1-47d0"}',
      activityKind: "tool.completed",
    });
    expect(readThreadMarkup).toContain("Glade read a thread");
    expect(readThreadMarkup).not.toContain("mcp__glade__glade_read_thread:");
    expect(readThreadMarkup).not.toContain("threadId");

    const dynamicToolMarkup = renderSingleToolRow({
      id: "work-dynamic-tool-args",
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "ToolSearch",
      tone: "tool",
      itemType: "dynamic_tool_call",
      toolName: "ToolSearch",
      toolTitle: "ToolSearch",
      detail: 'ToolSearch: {"query":"select:mcp__glade__glade_read_thread_events"}',
      activityKind: "tool.completed",
    });
    expect(dynamicToolMarkup).toContain("ToolSearch");
    expect(dynamicToolMarkup).not.toContain("&quot;query&quot;");

    const failedArgsMarkup = renderSingleToolRow({
      id: "work-glade-failed-args",
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "MCP tool call",
      tone: "tool",
      itemType: "mcp_tool_call",
      toolName: "mcp__glade__glade_create_threads",
      toolStatus: "failed",
      detail: 'McpError: {"code":-32602,"message":"Invalid params"}',
      activityKind: "tool.completed",
    });
    expect(failedArgsMarkup).toContain("Glade couldn&#x27;t create threads");
    expect(failedArgsMarkup).toContain("Invalid params");
  });

  it("renders inline edited rows from the turn summary when the file-change tool call has no filenames", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-assistant-inline-summary-fallback");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        timelineEntries={[
          {
            id: "entry-inline-summary-fallback",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-summary-fallback",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "File Change",
              tone: "tool",
              requestKind: "file-change",
            },
          },
          {
            id: "entry-assistant-inline-summary-fallback",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "done",
              createdAt: "2026-03-17T19:12:29.000Z",
              completedAt: "2026-03-17T19:12:30.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              assistantMessageId,
              {
                turnId: TurnId.makeUnsafe("turn-inline-summary-fallback-1"),
                completedAt: "2026-03-17T19:12:30.000Z",
                assistantMessageId,
                files: [
                  {
                    path: "apps/web/src/components/chat/ProviderHealth.ts",
                    additions: 63,
                    deletions: 4,
                  },
                  {
                    path: "apps/web/src/components/ChatView.tsx",
                    additions: 41,
                    deletions: 5,
                  },
                ],
              },
            ],
          ])
        }
      />,
    );

    expect(markup).toContain("Edited");
    expect(markup).toContain("ProviderHealth.ts");
    expect(markup).toContain("ChatView.tsx");
    expect(markup).toContain("+63");
    expect(markup).toContain("-4");
    expect(markup).toContain("+41");
    expect(markup).toContain("-5");
    expect(markup).not.toContain(">File Change<");
  });

  it("does not attribute shared workspace edits to a reply that ran no tools", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-assistant-diff");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        timelineEntries={[
          {
            id: "entry-assistant-diff",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "done",
              createdAt: "2026-03-17T19:12:29.000Z",
              completedAt: "2026-03-17T19:12:30.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              assistantMessageId,
              {
                turnId: TurnId.makeUnsafe("turn-diff-1"),
                checkpointTurnCount: 1,
                checkpointTurnCounts: [1],
                checkpointRef: CheckpointRef.makeUnsafe("refs/glade/checkpoints/thread/turn/1"),
                status: "ready",
                completedAt: "2026-03-17T19:12:30.000Z",
                assistantMessageId,
                files: [
                  { path: "apps/web/src/components/Sidebar.tsx", additions: 6, deletions: 5 },
                ],
              },
            ],
          ])
        }
        onUndoTurnFiles={() => {}}
      />,
    );

    expect(markup).toContain("done");
    expect(markup).not.toContain("Edited 1 file");
    expect(markup).not.toContain(">Undo<");
    expect(markup).not.toContain(">Review<");
    expect(markup).not.toContain("apps/web/src/components/Sidebar.tsx");
  });
});
