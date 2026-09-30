import { MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeActivity } from "../../storeTestFixtures";
import { formatShortTimestamp } from "../../timestampFormat";
import { deriveWorkLogEntries } from "../../workLog.entries";
import { COLLAPSED_USER_MESSAGE_MAX_CHARS } from "./userMessageCollapse";
import { FORK_SOURCE } from "./MessagesTimeline.testSetup";

import {
  makeForkImportedEntry,
  makeForkOwnedEntry,
  makeTimelineBaseProps,
} from "./MessagesTimeline.testSetup";

describe("MessagesTimeline", () => {
  it("renders an accent deep link to the immediate fork source", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        hasMessages
        timelineEntries={[makeForkImportedEntry(), makeForkOwnedEntry()]}
        forkSource={FORK_SOURCE}
        onOpenThread={() => {}}
      />,
    );

    expect(markup).toContain('data-fork-source-divider="true"');
    expect(markup).toContain('href="/source-thread"');
    expect(markup).toContain("Continued from chat");
    expect(markup).toContain("text-[var(--color-text-accent)]");
    expect(markup.indexOf("Imported history")).toBeLessThan(
      markup.indexOf('data-fork-source-divider="true"'),
    );
    expect(markup.indexOf('data-fork-source-divider="true"')).toBeLessThan(
      markup.indexOf("Fork-only turn"),
    );
  }, 30_000);

  it("renders session-context lifecycle evidence as a compact expandable row", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        timelineEntries={[
          {
            id: "context-restart-row",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "context-restart-entry",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "The session's history was lost, so the model continues from a summary.",
              tone: "error",
              activityKind: "provider.context.changed",
              providerContextLifecycle: {
                provider: "codex",
                nativeHistory: "unavailable",
                restartReason: "native-resume-failed",
                sessionRestarted: true,
                recapInjected: true,
                recapCharacters: 4_200,
                recapPreview: "Bounded summary preview",
                recapPreviewTruncated: true,
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("history was lost, so the model continues from a summary.");
    expect(markup).toContain('data-tool-detail-trigger="true"');
    expect(markup).not.toContain('data-provider-context-lifecycle-details="true"');
    expect(markup).not.toContain("Bounded summary preview");
  });

  it("keeps small transcripts on the simple non-virtualized path", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("assistant-message-1"),
              role: "assistant",
              text: "stable transcript body",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
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

    expect(markup).not.toContain('data-index="0"');
    expect(markup).not.toContain('class="relative" style="height:');
    expect(markup).toContain('data-timeline-row-kind="message"');
  });

  it("labels only the first message when another task created the conversation", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        crossTaskOrigin={{
          sourceThreadId: ThreadId.makeUnsafe("source-thread"),
          sourceProvider: "codex",
        }}
        timelineEntries={[
          {
            id: "entry-first-user",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("first-user-message"),
              role: "user",
              text: "Inspect the repository",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-second-user",
            kind: "message",
            createdAt: "2026-03-17T19:13:28.000Z",
            message: {
              id: MessageId.makeUnsafe("second-user-message"),
              role: "user",
              text: "Continue",
              createdAt: "2026-03-17T19:13:28.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onOpenThread={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup.match(/data-cross-task-origin="true"/g)).toHaveLength(1);
    expect(markup).toContain("Sent by Glade from another thread");
    expect(markup).toContain('aria-label="Open source thread"');
    expect(markup.indexOf("Sent by Glade from another thread")).toBeLessThan(
      markup.indexOf("Inspect the repository"),
    );
  });

  it("shows only the cross-task label (not the agent chip) when both apply", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        crossTaskOrigin={{
          sourceThreadId: ThreadId.makeUnsafe("source-thread"),
          sourceProvider: "codex",
        }}
        timelineEntries={[
          {
            id: "entry-first-user",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("first-user-message"),
              role: "user",
              text: "Inspect the repository",
              dispatchOrigin: "agent",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onOpenThread={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Sent by Glade from another thread");
    expect(markup).not.toContain("Sent by agent");
  });

  it("renders edit beside copy for user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-editable-user",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-editable-user"),
              role: "user",
              text: "adjust this prompt",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-editable-assistant",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: MessageId.makeUnsafe("message-editable-assistant"),
              role: "assistant",
              text: "",
              turnId: TurnId.makeUnsafe("turn-editable-user"),
              createdAt: "2026-03-17T19:12:29.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onEditUserMessage={() => true}
        editableUserMessageId={MessageId.makeUnsafe("message-editable-user")}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).toContain('aria-label="Edit message"');
    expect(markup).toContain("size-[1.125em]");
  });

  it("keeps edit available before a checkpoint exists", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-user-no-checkpoint",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-user-no-checkpoint"),
              role: "user",
              text: "still waiting on undo",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-assistant-no-checkpoint",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: MessageId.makeUnsafe("message-assistant-no-checkpoint"),
              role: "assistant",
              text: "",
              turnId: TurnId.makeUnsafe("turn-user-no-checkpoint"),
              createdAt: "2026-03-17T19:12:29.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onEditUserMessage={() => true}
        editableUserMessageId={MessageId.makeUnsafe("message-user-no-checkpoint")}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain('aria-label="Edit message"');
    expect(markup).not.toContain('title="Edit message"');
  });

  it("keeps edit available while an assistant turn is running", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
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
        turnDiffSummaryByAssistantMessageId={new Map()}
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onEditUserMessage={() => true}
        editableUserMessageId={MessageId.makeUnsafe("message-user-running")}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    const editButtonMarkup = markup.match(/<button[^>]*aria-label="Edit message"[^>]*>/)?.[0] ?? "";
    expect(markup).toContain('aria-label="Edit message"');
    expect(editButtonMarkup).not.toContain('disabled=""');
    expect(markup).not.toContain('title="Edit message"');
  });

  it("renders a 'Sent by agent' chip above agent-dispatched user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-agent-user-message",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-agent-user"),
              role: "user",
              text: "status check from the coordinator",
              dispatchOrigin: "agent",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
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

    expect(markup).toContain("Sent by agent");
    expect(markup).not.toContain("Sent via Automation");
    expect(markup).not.toContain("Steering conversation");
  });

  it("clamps long user messages visually and renders a separate Show more button", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const hiddenTail = "TAIL_SHOULD_STAY_HIDDEN";
    const longText = `${"a".repeat(COLLAPSED_USER_MESSAGE_MAX_CHARS)}${hiddenTail}`;
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-long-user-message",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-long-user"),
              role: "user",
              text: longText,
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
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

    expect(markup).toContain("Show more");

    expect(markup).toContain(hiddenTail);
    expect(markup).toContain('data-user-message-clamp="true"');
    expect(markup).toContain("max-height:");
    expect(markup).toContain("mask-image:linear-gradient");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/aria-controls="[^"]+"/);
  });

  it("renders assistant selection chips from hidden prompt markup when attachments are missing", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
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

    expect(markup).toContain("please use this");
    expect(markup).toContain("1 selection");
    expect(markup).not.toContain("&lt;assistant_selection&gt;");
  });

  it("keeps the generic working copy alongside the active compaction entry", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const [compactionEntry] = deriveWorkLogEntries(
      [
        makeActivity({
          id: "work-compacting",
          createdAt: "2026-03-17T19:12:28.000Z",
          kind: "context-compaction",
          summary: "Compacting context",
          tone: "info",
          payload: {
            itemType: "context_compaction",
            status: "inProgress",
            data: { item: { type: "contextCompaction", id: "compaction-1" } },
          },
        }),
      ],
      undefined,
    );
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking
        activeTurnInProgress
        timelineEntries={[
          {
            id: "entry-compacting",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: compactionEntry!,
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

    expect(markup).toContain("Compacting context");
    expect(markup).toContain("/central-icons-reversed/arrows-hide.svg");
    expect(markup).toContain("Thinking");
    expect(markup).not.toContain("h-px flex-1 bg-border");
  });

  it("does not reserve a timestamp footer between live status updates and Thinking", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const activeTurnId = TurnId.makeUnsafe("turn-live-status");
    const assistantCreatedAt = "2026-03-17T19:12:29.000Z";
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        isWorking
        activeTurnInProgress
        activeTurnId={activeTurnId}
        timelineEntries={[
          {
            id: "entry-tasks-updated",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.500Z",
            entry: {
              id: "work-tasks-updated",
              createdAt: "2026-03-17T19:12:28.500Z",
              label: "Tasks updated",
              tone: "info",
              turnId: activeTurnId,
            },
          },
          {
            id: "entry-live-assistant",
            kind: "message",
            createdAt: assistantCreatedAt,
            message: {
              id: MessageId.makeUnsafe("message-live-assistant"),
              role: "assistant",
              text: "",
              createdAt: assistantCreatedAt,
              streaming: false,
              turnId: activeTurnId,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Tasks updated");
    expect(markup).toContain("Thinking");
    expect(markup).not.toContain(formatShortTimestamp(assistantCreatedAt, "locale"));
    expect(markup).toMatch(/class="[^"]*\bpb-1\b[^"]*" data-timeline-row-kind="message"/);
  });

  it("folds work log summaries above the next assistant message footer", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        timelineEntries={[
          {
            id: "entry-work-inline",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-inline-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "turn",
              tone: "info",
            },
          },
          {
            id: "entry-assistant-inline",
            kind: "message",
            createdAt: "2026-03-17T19:12:29.000Z",
            message: {
              id: MessageId.makeUnsafe("message-assistant-inline"),
              role: "assistant",
              text: "done",
              createdAt: "2026-03-17T19:12:29.000Z",
              completedAt: "2026-03-17T19:12:30.000Z",
              streaming: false,
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

    expect(markup).toContain(formatShortTimestamp("2026-03-17T19:12:29.000Z", "locale"));
    expect(markup).toContain("Worked for 1.0s");
    expect(markup).not.toContain("data-scroll-anchor-ignore");
    expect(markup).not.toContain(
      `${formatShortTimestamp("2026-03-17T19:12:29.000Z", "locale")} • 1.0s`,
    );
    expect(markup).not.toContain("Work log");
  });

  it("renders Claude agent task output through the shared markdown renderer", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking
        activeTurnInProgress
        timelineEntries={[
          {
            id: "entry-claude-agent-task",
            kind: "work",
            createdAt: "2026-05-09T16:31:20.000Z",
            entry: {
              id: "work-claude-agent-task",
              createdAt: "2026-05-09T16:31:20.000Z",
              label: "Agent task",
              tone: "tool",
              itemType: "collab_agent_tool_call",
              toolTitle: "Map file-icon logic in file-changes",
              detail: [
                "## Complete File-Icon Rendering Map",
                "",
                "```tsx",
                'const iconName = "react";',
                "```",
              ].join("\n"),
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

    expect(markup).toContain("<h2>Complete File-Icon Rendering Map</h2>");
    expect(markup).toContain("chat-markdown-codeblock");
    expect(markup).not.toContain("```tsx");
  });

  it("renders a lone reasoning update as iconless tool text", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const activeTurnId = TurnId.makeUnsafe("turn-reasoning-lone");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking
        activeTurnInProgress
        activeTurnId={activeTurnId}
        timelineEntries={[
          {
            id: "entry-reasoning-trace",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.100Z",
            entry: {
              id: "reasoning-trace",
              createdAt: "2026-03-17T19:12:28.100Z",
              turnId: activeTurnId,
              label: "Reasoning trace",
              toolTitle: "Reasoning trace",
              detail: "**Inspecting apps/web/src/store.ts**\n\n<!-- -->",
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

    expect(markup.match(/data-codex-status-row="true"/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain('data-work-entry-icon="true"');
    expect(markup).toContain("Inspecting apps/web/src/store.ts");
    expect(markup).not.toContain("Reasoning trace Inspecting");
  });

  it.each([
    {
      provider: "Codex",
      expectedText: "Checking git status",
      activity: makeActivity({
        id: "codex-live-tool",
        createdAt: "2026-03-17T19:12:28.100Z",
        turnId: "turn-provider-live-tool",
        kind: "tool.started",
        summary: "Ran command started",
        payload: {
          itemType: "command_execution",
          status: "inProgress",
          title: "Ran command",
          data: {
            item: {
              type: "commandExecution",
              id: "codex-tool-1",
              command: "/bin/zsh -lc 'git status --short'",
              status: "inProgress",
              commandActions: [{ type: "unknown", command: "git status --short" }],
            },
          },
        },
      }),
    },
  ])("renders $provider tool activity beside live Thinking", async ({ activity, expectedText }) => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const activeTurnId = TurnId.makeUnsafe("turn-provider-live-tool");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...makeTimelineBaseProps()}
        isWorking
        activeTurnInProgress
        activeTurnId={activeTurnId}
        timelineEntries={deriveWorkLogEntries([activity], activeTurnId).map((entry) => ({
          id: entry.id,
          kind: "work" as const,
          createdAt: entry.createdAt,
          entry,
        }))}
      />,
    );

    expect(markup).toContain('data-timeline-row-kind="work"');
    expect(markup).toContain('data-work-entry-display-text="true"');
    expect(markup).toContain('data-live-activity-meta="true"');
    expect(markup).toContain(">Thinking<");
    expect(markup).toContain(expectedText);
  });
});
