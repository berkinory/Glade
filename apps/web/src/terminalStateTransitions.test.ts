import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { expect, it } from "vitest";
import { terminalTabGroups, terminalLayoutPositions } from "./terminalLayout";
import {
  createDefaultThreadTerminalState,
  sanitizePersistedTerminalStateByThreadId,
} from "./terminalStateNormalization";
import {
  closeThreadTerminal,
  newThreadTerminal,
  splitThreadTerminal,
} from "./terminalStateTransitions";

it("keeps mixed splits in one persisted tab and collapses an exited root without dropping surviving sessions", () => {
  const initial = createDefaultThreadTerminalState();
  const root = initial.activeTerminalId;
  const split = splitThreadTerminal(
    splitThreadTerminal(initial, "right", "vertical"),
    "bottom",
    "horizontal",
  );
  const threadId = ThreadId.makeUnsafe("terminal-tiling");
  const restored = sanitizePersistedTerminalStateByThreadId(
    JSON.parse(JSON.stringify({ [threadId]: split })),
  )[threadId]!;
  const groups = terminalTabGroups(restored);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.terminalIds).toEqual([root, "right", "bottom"]);
  expect(terminalLayoutPositions(groups[0]!.layout)).toEqual({
    [root]: { left: "0%", top: "0%", width: "50%", height: "100%" },
    right: { left: "50%", top: "0%", width: "50%", height: "50%" },
    bottom: { left: "50%", top: "50%", width: "50%", height: "50%" },
  });
  const closed = closeThreadTerminal(restored, root);
  expect(closed.terminalIds).toEqual(["right", "bottom"]);
  expect(terminalTabGroups(closed)[0]?.id).toBe(root);
  expect(terminalLayoutPositions(terminalTabGroups(closed)[0]!.layout)).toEqual({
    right: { left: "0%", top: "0%", width: "100%", height: "50%" },
    bottom: { left: "0%", top: "50%", width: "100%", height: "50%" },
  });
});

it("keeps separately opened terminals separate and does not steal their sessions when another tab splits or closes", () => {
  const initial = createDefaultThreadTerminalState();
  const separate = newThreadTerminal(initial, "second-tab");
  const split = splitThreadTerminal(separate, "second-pane", "vertical");
  expect(terminalTabGroups(split).map((group) => group.terminalIds)).toEqual([
    [initial.activeTerminalId],
    ["second-tab", "second-pane"],
  ]);
  const closed = closeThreadTerminal(split, "second-pane");
  expect(terminalTabGroups(closed).map((group) => group.terminalIds)).toEqual([
    [initial.activeTerminalId],
    ["second-tab"],
  ]);
  expect(closed.activeTerminalId).toBe("second-tab");
});
