import { describe, expect, it } from "vitest";

import {
  collectEditableUserMessageIds,
  collectTailTurnIds,
  resolveUserMessageEditTarget,
} from "./conversationEdit";

type Message = Parameters<typeof resolveUserMessageEditTarget>[0]["messages"][number];

function expectEditable(
  messages: ReadonlyArray<Message>,
  activeTurnId: string | null,
  expected: ReadonlyArray<string>,
) {
  expect([...collectEditableUserMessageIds({ messages, activeTurnId })].toSorted()).toEqual(
    [...expected].toSorted(),
  );
  for (const message of messages) {
    expect(
      resolveUserMessageEditTarget({ messages, messageId: message.id, activeTurnId }).editable,
    ).toBe(expected.includes(message.id));
  }
}

describe("conversationEdit", () => {
  it.each([null, "turn-1", "turn-2"])(
    "does not skip an async answer with turn %s to edit the earlier prompt while it runs",
    (answerTurnId) => {
      const messages = [
        { id: "prompt", role: "user", source: "native", turnId: "turn-1" },
        { id: "answer", role: "user", source: "async-user-input", turnId: answerTurnId },
      ];
      expect(
        resolveUserMessageEditTarget({ messages, messageId: "prompt", activeTurnId: "turn-1" }),
      ).toEqual({ editable: false, reason: "earlier-message-while-running" });
      expectEditable(messages, "turn-1", []);
    },
  );

  it("allows a new native prompt after a structured answer", () => {
    expect(
      resolveUserMessageEditTarget({
        messages: [
          { id: "answer", role: "user", source: "async-user-input", turnId: "turn-1" },
          { id: "prompt", role: "user", source: "native", turnId: "turn-2" },
        ],
        messageId: "prompt",
      }),
    ).toMatchObject({ editable: true, messageId: "prompt", removedTurnIds: ["turn-2"] });
  });

  it("rejects generated question replies even when the question is outside the loaded history", () => {
    expectEditable(
      [{ id: "answer", role: "user", source: "async-user-input", turnId: "turn-2" }],
      null,
      [],
    );
  });

  it("also protects legacy native replies linked to a structured question", () => {
    const messages = [
      { id: "question", role: "assistant", asyncUserInput: { response: { messageId: "answer" } } },
      { id: "answer", role: "user", source: "native", turnId: "turn-2" },
    ];
    expect(resolveUserMessageEditTarget({ messages, messageId: "answer" })).toEqual({
      editable: false,
      reason: "structured-answer",
    });
    expectEditable(messages, null, []);
  });

  it("collects unique turn ids from a target message through the tail", () => {
    expect(
      collectTailTurnIds({
        messages: [
          { id: "m1", turnId: "turn-1" },
          { id: "m2", turnId: null },
          { id: "m3", turnId: "turn-2" },
          { id: "m4", turnId: "turn-2" },
        ],
        messageId: "m2",
      }),
    ).toEqual(["turn-2"]);
  });

  it("allows editing the native user message for the latest concrete turn", () => {
    expect(
      resolveUserMessageEditTarget({
        messages: [
          { id: "user-1", role: "user", source: "native", turnId: null },
          { id: "assistant-1", role: "assistant", source: "native", turnId: "turn-1" },
        ],
        messageId: "user-1",
      }),
    ).toEqual({
      editable: true,
      messageId: "user-1",
      messageIndex: 0,
      mode: "rollback",
      rollbackTurnCount: 1,
      removedTurnIds: ["turn-1"],
    });
  });

  it("allows editing the active tail prompt before assistant output exists", () => {
    expect(
      resolveUserMessageEditTarget({
        messages: [{ id: "user-active", role: "user", source: "native", turnId: null }],
        messageId: "user-active",
        activeTurnId: "turn-active",
      }),
    ).toMatchObject({
      editable: true,
      mode: "active-tail",
      rollbackTurnCount: 0,
      removedTurnIds: [],
    });
  });

  it("keeps a textless stopped prompt editable after system notices", () => {
    expectEditable(
      [
        { id: "user-stopped", role: "user", source: "native", turnId: null },
        { id: "notice", role: "system", turnId: null },
      ],
      null,
      ["user-stopped"],
    );
  });

  it("does not count system notice ids as extra provider turns", () => {
    expect(
      resolveUserMessageEditTarget({
        messages: [
          { id: "user", role: "user", source: "native", turnId: "turn-1" },
          { id: "notice", role: "system", turnId: "notice-turn" },
        ],
        messageId: "user",
      }),
    ).toMatchObject({ editable: true, removedTurnIds: ["turn-1"] });
  });

  const twoTurns = [
    { id: "user-1", role: "user", source: "native", turnId: null },
    { id: "assistant-1", role: "assistant", source: "native", turnId: "turn-1" },
    { id: "user-2", role: "user", source: "native", turnId: null },
    { id: "assistant-2", role: "assistant", source: "native", turnId: "turn-2" },
  ];

  it("edits an earlier message by rolling back every later turn", () => {
    expect(resolveUserMessageEditTarget({ messages: twoTurns, messageId: "user-1" })).toEqual({
      editable: true,
      messageId: "user-1",
      messageIndex: 0,
      mode: "rollback",
      rollbackTurnCount: 2,
      removedTurnIds: ["turn-1", "turn-2"],
    });
    expectEditable(twoTurns, null, ["user-1", "user-2"]);
  });

  it("only offers the latest message while a turn runs", () => {
    expectEditable(twoTurns, "turn-2", ["user-2"]);
  });

  it("rejects old tail messages that do not have turn metadata", () => {
    const messages = [
      { id: "user-old", role: "user", source: "native", turnId: null },
      { id: "assistant-old", role: "assistant", source: "native", turnId: null },
    ];
    expect(resolveUserMessageEditTarget({ messages, messageId: "user-old" })).toEqual({
      editable: false,
      reason: "missing-turn-metadata",
    });
    expectEditable(messages, null, []);
  });
});
