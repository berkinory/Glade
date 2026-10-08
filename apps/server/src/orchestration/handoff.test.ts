import { MessageId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationMessage } from "@glade/contracts/orchestration/threadEntities";
import { describe, expect, it } from "vitest";

import { buildPriorTranscriptBootstrapText, listPriorTranscriptMessages } from "./handoff.ts";

const message = (
  index: number,
  role: "user" | "assistant",
  text: string,
): OrchestrationMessage => ({
  id: MessageId.makeUnsafe(`message-${index}`),
  role,
  text,
  turnId: null,
  streaming: false,
  source: "native",
  createdAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
});

const thread = (messages: ReadonlyArray<OrchestrationMessage>) => ({
  title: "Budgeted thread",
  branch: null,
  worktreePath: null,
  messages,
});

describe("listPriorTranscriptMessages", () => {
  it("preserves prior message identity and order while excluding incomplete and empty text", () => {
    const first = message(0, "user", "  keep this text  ");
    const second = message(1, "assistant", "\u200b");
    const current = message(5, "user", "current");
    const messages = [
      first,
      second,
      message(2, "user", "\n\r\t\u00a0\ufeff\u2028"),
      { ...message(3, "assistant", "streaming"), streaming: true },
      current,
      message(6, "assistant", "later"),
    ];
    const result = listPriorTranscriptMessages(thread(messages), current.id);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
    expect(listPriorTranscriptMessages(thread(messages), first.id)).toEqual([]);
  });
});

describe("buildPriorTranscriptBootstrapText", () => {
  it("keeps every message with a plain summary header when under budget", () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      message(index, index % 2 === 0 ? "user" : "assistant", `marker-${index} short message`),
    );
    const text = buildPriorTranscriptBootstrapText(thread(messages), "message-9");

    expect(text).not.toBeNull();
    expect(text).toContain("Earlier conversation summary:");
    expect(text).not.toContain("omitted to fit the context budget");
    for (let index = 0; index < 9; index += 1) {
      expect(text).toContain(`marker-${index}`);
    }
  });

  it("drops the oldest summaries and notes the omission when over budget", () => {
    const filler = "x".repeat(400);
    const messages = Array.from({ length: 301 }, (_, index) =>
      message(index, index % 2 === 0 ? "user" : "assistant", `marker-${index} ${filler}`),
    );
    const text = buildPriorTranscriptBootstrapText(thread(messages), "message-300");

    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(32_000);
    expect(text).toContain("omitted to fit the context budget");

    expect(text).toContain("marker-299");
    expect(text).toContain("marker-294");
    expect(text).not.toContain("marker-0 ");
    expect(text).not.toContain("marker-1 ");

    expect(text!.indexOf("marker-250")).toBeLessThan(text!.indexOf("marker-290"));
  });

  it.each([
    { earlyCount: 5, filler: "e".repeat(60), budget: 800, omittedDigits: 1 },
    { earlyCount: 150, filler: "z".repeat(40), budget: 1_600, omittedDigits: 3 },
  ])(
    "keeps the newest message within budget when $earlyCount earlier messages need an omission header",
    ({ earlyCount, filler, budget, omittedDigits }) => {
      const role = (index: number) => (index % 2 === 0 ? "user" : "assistant");
      const messages = [
        ...Array.from({ length: earlyCount }, (_, index) =>
          message(index, role(index), `EARLY-${index} ${filler}`),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          message(earlyCount + index, role(index), `plain-recent-${index}`),
        ),
        message(
          earlyCount + 5,
          "assistant",
          `NEWEST-START ${"r".repeat(10)} NEWEST-END-UNIQUE-MARKER`,
        ),
        message(earlyCount + 6, "user", "current turn"),
      ];

      const text = buildPriorTranscriptBootstrapText(
        thread(messages),
        `message-${earlyCount + 6}`,
        budget,
      );

      expect(text).not.toBeNull();
      expect(text!.length).toBeLessThanOrEqual(budget);
      expect(text).toContain("NEWEST-START");
      expect(text).toContain("NEWEST-END-UNIQUE-MARKER");
      expect(text).toMatch(
        new RegExp(
          `\\(\\d{${omittedDigits},} older messages? omitted to fit the context budget\\):`,
        ),
      );
    },
  );
});
