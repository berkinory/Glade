import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it, vi } from "vitest";

import {
  collectActiveTerminalThreadIds,
  registerTerminalRuntimeCleanup,
  removeOrphanedTerminalRuntimes,
} from "./terminalStateCleanup";

const threadId = (id: string): ThreadId => ThreadId.makeUnsafe(id);

it("cleans up loaded runtimes synchronously without a stale registration replacing the current one", () => {
  const active = new Set(["active", "dock-terminal:active", "draft"]);
  expect(() => removeOrphanedTerminalRuntimes(active)).not.toThrow();
  const oldCleanup = vi.fn();
  const newCleanup = vi.fn();
  const unregisterOld = registerTerminalRuntimeCleanup(oldCleanup);
  const unregisterNew = registerTerminalRuntimeCleanup(newCleanup);
  unregisterOld();
  removeOrphanedTerminalRuntimes(active);
  expect(oldCleanup).not.toHaveBeenCalled();
  expect(newCleanup).toHaveBeenCalledWith(active);
  unregisterNew();
  removeOrphanedTerminalRuntimes(new Set());
  expect(newCleanup).toHaveBeenCalledOnce();
});

const live = (id: string) => ({ id: threadId(id), deletedAt: null, archivedAt: null });
const deleted = (id: string) => ({ ...live(id), deletedAt: "2026-03-05T08:00:00.000Z" });
const archived = (id: string) => ({ ...live(id), archivedAt: "2026-03-05T09:00:00.000Z" });

describe("collectActiveTerminalThreadIds", () => {
  it.each([
    {
      name: "ignores deleted server threads and keeps local draft threads",
      snapshotThreads: [live("server-active"), deleted("server-deleted")],
      draftThreadIds: ["local-draft"],
      retainedThreadIds: [],
      expected: ["server-active", "local-draft"],
    },
    {
      name: "retains explicitly provided terminal scopes",
      snapshotThreads: [],
      draftThreadIds: [],
      retainedThreadIds: ["retained:alpha", "retained:beta"],
      expected: ["retained:alpha", "retained:beta"],
    },
    {
      name: "ignores archived server threads",
      snapshotThreads: [live("server-active"), archived("server-archived")],
      draftThreadIds: [],
      retainedThreadIds: [],
      expected: ["server-active"],
    },
    {
      name: "does not retain draft-linked state for archived server threads",
      snapshotThreads: [archived("server-archived")],
      draftThreadIds: ["server-archived", "local-draft"],
      retainedThreadIds: [],
      expected: ["local-draft"],
    },
  ])("$name", ({ snapshotThreads, draftThreadIds, retainedThreadIds, expected }) => {
    expect(
      collectActiveTerminalThreadIds({
        snapshotThreads,
        draftThreadIds: draftThreadIds.map(threadId),
        retainedThreadIds: retainedThreadIds.map(threadId),
      }),
    ).toEqual(new Set(expected.map(threadId)));
  });
});
