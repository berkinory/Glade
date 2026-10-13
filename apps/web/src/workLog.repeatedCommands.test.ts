import { TurnId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "./workLog.types";
import { foldRepeatedCommands } from "./workLog.repeatedCommands";

const run = (id: string, overrides: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id,
  createdAt: `2026-10-14T00:00:0${id}.000Z`,
  label: "Ran command",
  tone: "tool",
  itemType: "command_execution",
  command: "bun run test",
  turnId: null,
  toolStatus: "completed",
  ...overrides,
});

describe("foldRepeatedCommands", () => {
  it("folds back-to-back runs into the latest, keeping the first run's place", () => {
    const folded = foldRepeatedCommands([
      run("1", { detail: "first" }),
      run("2", { detail: "second" }),
      run("3", { detail: "third" }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ id: "1", repeatCount: 3, detail: "third" });
  });

  it.each([
    ["a different command between them", [run("1"), run("2", { command: "ls" }), run("3")], 3],
    ["a run still going", [run("1"), run("2", { toolStatus: "running" })], 2],
    ["another turn", [run("1"), run("2", { turnId: TurnId.makeUnsafe("turn-2") })], 2],
  ] as const)("keeps runs apart across %s", (_name, entries, length) => {
    expect(foldRepeatedCommands(entries)).toHaveLength(length);
  });
});
