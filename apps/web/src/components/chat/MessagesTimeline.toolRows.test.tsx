import { CheckpointRef, MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeActivity } from "../../storeTestFixtures";
import { deriveWorkLogEntries } from "../../workLog.entries";
import type { WorkLogEntry } from "../../workLog.types";

import { TOOLTIP_TRIGGER_MARKER, makeTimelineBaseProps } from "./MessagesTimeline.testSetup";

describe("MessagesTimeline tool rows", () => {
  it("attaches trailing tool rows to the last assistant reply after completion", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-assistant-final",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: MessageId.makeUnsafe("message-assistant-final"),
              role: "assistant",
              text: "done",
              createdAt: "2026-03-17T19:12:29.000Z",
              completedAt: "2026-03-17T19:12:30.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-trailing-tool-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:30.100Z",
            entry: {
              id: "work-trailing-tool-1",
              createdAt: "2026-03-17T19:12:30.100Z",
              label: "tool 1",
              tone: "tool",
            },
          },
          {
            id: "entry-trailing-tool-2",
            kind: "work",
            createdAt: "2026-03-17T19:12:30.200Z",
            entry: {
              id: "work-trailing-tool-2",
              createdAt: "2026-03-17T19:12:30.200Z",
              label: "tool 2",
              tone: "tool",
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Worked for");
    expect(markup).toContain(">done</p>");

    expect(markup).not.toContain("Tool 1");
    expect(markup).not.toContain("Tool 2");
    expect(markup).not.toContain('data-timeline-row-kind="work"');
  });

  it("renders inline file-change tool calls as edited rows with diff stats", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-assistant-inline-edit");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-inline-file-change",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-file-change",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "File Change",
              tone: "tool",
              requestKind: "file-change",
              changedFiles: ["apps/web/src/components/chat/MessagesTimeline.test.tsx"],
              toolDetails: {
                kind: "file-change",
                title: "Edited",
                diff: [
                  "diff --git a/apps/web/src/components/chat/MessagesTimeline.test.tsx b/apps/web/src/components/chat/MessagesTimeline.test.tsx",
                  "-old",
                  "+new",
                ].join("\n"),
                files: ["apps/web/src/components/chat/MessagesTimeline.test.tsx"],
              },
            },
          },
          {
            id: "entry-assistant-inline-edit",
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
                turnId: TurnId.makeUnsafe("turn-inline-edit-1"),
                completedAt: "2026-03-17T19:12:30.000Z",
                assistantMessageId,
                files: [
                  {
                    path: "apps/web/src/components/chat/MessagesTimeline.test.tsx",
                    additions: 1,
                    deletions: 1,
                  },
                ],
              },
            ],
          ])
        }
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Edited");
    expect(markup).toContain("MessagesTimeline.test.tsx");
    expect(markup).toContain("+1");
    expect(markup).toContain("-1");
    expect(markup).not.toContain(
      "File Change - apps/web/src/components/chat/MessagesTimeline.test.tsx",
    );
  });

  it("marks visible file-change rows with captured details as clickable", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-file-change-details",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-file-change-details",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "File Change",
              tone: "tool",
              requestKind: "file-change",
              changedFiles: ["apps/web/src/components/chat/MessagesTimeline.test.tsx"],
              toolDetails: {
                kind: "file-change",
                title: "Edited",
                diff: "-old\n+new",
                files: ["apps/web/src/components/chat/MessagesTimeline.test.tsx"],
              },
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain('data-tool-detail-trigger="true"');
    expect(markup).toContain(TOOLTIP_TRIGGER_MARKER);
    expect(markup).not.toContain('data-tool-details-inline="true"');
    expect(markup).not.toContain("Diff");
    expect(markup).not.toContain("Details");
  });

  it("renders command rows with a readable summary and styled hover tooltip trigger", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-inline-command",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-command",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Ran command",
              tone: "tool",
              itemType: "command_execution",
              toolTitle: "Searched",
              command: `rg -n "ProjectionSnapshotQuery" apps/server/src`,
              rawCommand: `/bin/zsh -lc 'rg -n "ProjectionSnapshotQuery" apps/server/src'`,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Searched");
    expect(markup).toContain("for ProjectionSnapshotQuery in server/src");
    expect(markup).not.toContain("data-work-entry-action-word");
    expect(markup).toContain(TOOLTIP_TRIGGER_MARKER);
    expect(markup).not.toContain(
      `title="/bin/zsh -lc &#x27;rg -n &quot;ProjectionSnapshotQuery&quot; apps/server/src&#x27;"`,
    );
    expect(markup).not.toContain("&gt;/bin/zsh -lc");
  });

  it("shows the Glade mark for every provider-specific tool row shape", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const baseProps = makeTimelineBaseProps();

    const claudeMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...baseProps}
        timelineEntries={[
          {
            id: "entry-inline-glade-claude",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-glade-claude",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "MCP tool call",
              tone: "tool",
              itemType: "dynamic_tool_call",
              toolTitle: "Glade__glade_create_thread",
              toolName: "Glade__glade_create_thread",
              detail: "Glade__glade_create_thread",
              activityKind: "tool.started",
            },
          },
        ]}
      />,
    );
    expect(claudeMarkup).toContain('data-tool-icon="glade"');
    expect(claudeMarkup).not.toContain('data-tool-icon="mcp"');
    expect(claudeMarkup).toContain("Glade is creating a thread");
    expect(claudeMarkup).not.toContain("Glade__glade_create_thread");

    const codexMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...baseProps}
        timelineEntries={[
          {
            id: "entry-inline-glade-codex",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-glade-codex",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "MCP tool call",
              tone: "tool",
              itemType: "file_change",
              toolTitle: "mcp__Glade__glade_list_threads",
              detail: "mcp__Glade__glade_list_threads",
            },
          },
        ]}
      />,
    );
    expect(codexMarkup).toContain('data-tool-icon="glade"');
    expect(codexMarkup).toContain("Glade listed threads");
    expect(codexMarkup).not.toContain("mcp__Glade__glade_list_threads");

    const failedMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...baseProps}
        timelineEntries={[
          {
            id: "entry-inline-glade-failed",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-glade-failed",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "MCP tool call",
              tone: "tool",
              itemType: "mcp_tool_call",
              toolName: "mcp__glade__glade_create_threads",
              toolStatus: "failed",
              detail: "Claude rejected reasoningEffort",
              activityKind: "tool.completed",
            },
          },
        ]}
      />,
    );
    expect(failedMarkup).toContain("Glade couldn&#x27;t create threads");
    expect(failedMarkup).toContain("Claude rejected reasoningEffort");
  });

  it.each(["computer_click", "computer_browser_click"])(
    "uses the requested cursor and contextual label for %s",
    async (toolName) => {
      const { MessagesTimeline } = await import("./MessagesTimeline");
      const [entry] = deriveWorkLogEntries(
        [
          makeActivity({
            id: "computer-human-label",
            kind: "tool.completed",
            summary: "Tool",
            payload: {
              itemType: "mcp_tool_call",
              toolName,
              arguments: { label: "Search", app: "Safari", x: 123, y: 456 },
            },
          }),
        ],
        undefined,
      );
      const markup = renderToStaticMarkup(
        <MessagesTimeline
          {...makeTimelineBaseProps()}
          timelineEntries={[
            {
              id: "computer-row",
              kind: "work",
              createdAt: entry!.createdAt,
              entry: entry!,
            },
          ]}
        />,
      );
      expect(markup).toContain('data-tool-icon="computer"');
      expect(markup).toContain("central-icons-reversed/cursor-1.svg");
      expect(markup).toContain(
        toolName.includes("browser") ? "Click in the browser" : "Click on “Search” in Safari",
      );
      expect(markup).not.toContain("Glade clicked the desktop");
      expect(markup).not.toContain("123, 456");
      expect(markup).not.toContain('data-tool-icon="mcp"');
    },
  );

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

    const diagnoseMarkup = renderSingleToolRow({
      id: "work-glade-diagnose-args",
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "MCP tool call",
      tone: "tool",
      itemType: "mcp_tool_call",
      toolName: "mcp__glade__glade_diagnose_thread",
      detail: 'mcp__glade__glade_diagnose_thread: {"threadId":"09a1615d-084f-40b9"}',
      activityKind: "tool.completed",
    });
    expect(diagnoseMarkup).toContain("Glade diagnosed a thread");
    expect(diagnoseMarkup).not.toContain("mcp__glade__glade_diagnose_thread:");
    expect(diagnoseMarkup).not.toContain("threadId");

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

  it("keeps Glade tool calls and adds a thread creation recap at the end of the turn", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-glade-recap");
    const workEntries = [
      {
        id: "entry-glade-create-tool",
        kind: "work",
        createdAt: "2026-03-17T19:12:28.000Z",
        entry: {
          id: "work-glade-create-tool",
          createdAt: "2026-03-17T19:12:28.000Z",
          label: "MCP tool call",
          tone: "tool",
          itemType: "mcp_tool_call",
          toolName: "mcp__glade__glade_create_threads",
          toolTitle: "Glade created threads",
          activityKind: "tool.completed",
        },
      },
      {
        id: "entry-glade-create-recap",
        kind: "work",
        createdAt: "2026-03-17T19:12:29.000Z",
        entry: {
          id: "work-glade-create-recap",
          createdAt: "2026-03-17T19:12:29.000Z",
          label: "Created 2 Glade threads",
          tone: "info",
          activityKind: "glade.threads.created",
          gladeThreadCreation: {
            operationId: "gateway:create:two-workers",
            requestedCount: 2,
            createdCount: 2,
            threads: [
              {
                threadId: "thread-terra",
                title: "Explain the repository with Terra",
                provider: "codex",
                model: "gpt-5.6-terra",
                environment: "local",
                status: "task_dispatched",
              },
              {
                threadId: "thread-claude",
                title: "Explain the repository with Claude",
                provider: "claudeAgent",
                model: "claude-sonnet-5",
                environment: "worktree",
                status: "task_dispatched",
              },
            ],
          },
        },
      },
    ] as const;
    const baseProps = {
      ...makeTimelineBaseProps(),
      nowIso: "2026-03-17T19:12:31.000Z",
      onOpenThread: () => {},
    };
    const liveMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...baseProps}
        isWorking
        activeTurnInProgress
        timelineEntries={[...workEntries]}
      />,
    );
    expect(liveMarkup).toContain("Glade created threads");
    expect(liveMarkup).not.toContain('data-glade-thread-creation-card="true"');

    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...baseProps}
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          ...workEntries,
          {
            id: "entry-glade-recap-assistant",
            kind: "message",
            createdAt: "2026-03-17T19:12:30.000Z",
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "Both threads are running.",
              createdAt: "2026-03-17T19:12:30.000Z",
              completedAt: "2026-03-17T19:12:31.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Worked for");
    expect(markup).toContain('data-glade-thread-creation-card="true"');
    expect(markup).toContain("2 threads created");
    expect(markup).toContain("2/2 requested threads created");
    expect(markup).toContain("Explain the repository with Terra");
    expect(markup).toContain("Explain the repository with Claude");
    expect(markup).toContain("GPT-5.6 Terra");
    expect(markup).toContain("Claude Sonnet 5");
    expect(markup.indexOf("Both threads are running.")).toBeLessThan(
      markup.indexOf('data-glade-thread-creation-card="true"'),
    );
  });

  it("shows the Computer setup card after the answer instead of inside the settled fold", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MessagesTimeline
          {...makeTimelineBaseProps()}
          isWorking={false}
          activeTurnInProgress={false}
          timelineEntries={[
            {
              id: "entry-computer-tool",
              kind: "work",
              createdAt: "2026-03-17T19:12:28.000Z",
              entry: {
                id: "work-computer-tool",
                createdAt: "2026-03-17T19:12:28.000Z",
                label: "MCP tool call",
                tone: "tool",
                itemType: "mcp_tool_call",
                toolTitle: "Listed windows",
                activityKind: "tool.completed",
              },
            },
            {
              id: "entry-computer-setup",
              kind: "work",
              createdAt: "2026-03-17T19:12:29.000Z",
              entry: {
                id: "work-computer-setup",
                createdAt: "2026-03-17T19:12:29.000Z",
                label: "Computer setup required",
                tone: "error",
                computerSetupRequired: { missing: ["screenRecording"] },
              },
            },
            {
              id: "entry-computer-setup-assistant",
              kind: "message",
              createdAt: "2026-03-17T19:12:30.000Z",
              message: {
                id: MessageId.makeUnsafe("message-computer-setup"),
                role: "assistant",
                text: "Glade needs macOS permissions first.",
                createdAt: "2026-03-17T19:12:30.000Z",
                completedAt: "2026-03-17T19:12:31.000Z",
                streaming: false,
              },
            },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("Worked for");
    expect(markup.match(/Computer control needs Screen Recording/g)).toHaveLength(1);
    expect(markup.indexOf("Glade needs macOS permissions first.")).toBeLessThan(
      markup.indexOf("Computer control needs Screen Recording"),
    );
  });

  it("anchors the changed-files summary at the end of a collapsed file-change turn", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-assistant-inline-multi-edit");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-inline-multi-file-change",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-multi-file-change",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "File Change",
              tone: "tool",
              requestKind: "file-change",
              changedFiles: [
                "apps/web/src/components/chat/MessagesTimeline.test.tsx",
                "apps/web/src/components/chat/MessagesTimeline.tsx",
              ],
            },
          },
          {
            id: "entry-assistant-inline-multi-edit",
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
                turnId: TurnId.makeUnsafe("turn-inline-multi-edit-1"),
                completedAt: "2026-03-17T19:12:30.000Z",
                assistantMessageId,
                files: [
                  {
                    path: "apps/web/src/components/chat/MessagesTimeline.test.tsx",
                    additions: 1,
                    deletions: 1,
                  },
                  {
                    path: "apps/web/src/components/chat/MessagesTimeline.tsx",
                    additions: 2,
                    deletions: 0,
                  },
                ],
              },
            ],
          ])
        }
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Worked for");
    expect(markup).toContain("Edited 2 files");
    expect(markup).toContain("apps/web/src/components/chat/MessagesTimeline.test.tsx");
    expect(markup).toContain("apps/web/src/components/chat/MessagesTimeline.tsx");
    expect(markup).toContain("+1");
    expect(markup).toContain("-1");
    expect(markup).toContain("+2");
    expect(markup).not.toContain(">apps/web/src/components/chat<");
  });

  it("renders inline edited rows from the turn summary when the file-change tool call has no filenames", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.makeUnsafe("message-assistant-inline-summary-fallback");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
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
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
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
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
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
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onUndoTurnFiles={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("done");
    expect(markup).not.toContain("Edited 1 file");
    expect(markup).not.toContain(">Undo<");
    expect(markup).not.toContain(">Review<");
    expect(markup).not.toContain("apps/web/src/components/Sidebar.tsx");
  });
});
