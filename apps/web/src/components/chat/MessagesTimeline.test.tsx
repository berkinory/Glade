import { MessageId, TurnId } from "@glade/contracts/core/baseSchemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
