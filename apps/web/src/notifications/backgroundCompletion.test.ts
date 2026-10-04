import { deriveBackgroundWork } from "@glade/shared/threads/backgroundWork";
import { describe, expect, it } from "vitest";
import { TurnId } from "@glade/contracts/core/baseSchemas";
import { makeActivity, makeThread } from "../storeTestFixtures";
import { collectCompletedThreadCandidates } from "./taskCompletion.logic";

const turnId = TurnId.makeUnsafe("parent");
const settled = makeThread({
  latestTurn: {
    turnId,
    state: "completed",
    requestedAt: "2026-10-03T10:00:00.000Z",
    startedAt: "2026-10-03T10:00:00.000Z",
    completedAt: "2026-10-03T10:01:00.000Z",
    assistantMessageId: null,
  },
});
const started = ["a", "b"].flatMap((taskId, index) => [
  makeActivity({ kind: "task.started", turnId, payload: { taskId }, sequence: index * 2 + 1 }),
  makeActivity({
    kind: "task.updated",
    turnId,
    payload: { taskId, isBackgrounded: true },
    sequence: index * 2 + 2,
  }),
]);
const completed = (taskId: string, status = "completed") =>
  makeActivity({
    kind: "task.completed",
    payload: { taskId, status },
    sequence: taskId === "a" ? 5 : 6,
  });

describe("background completion delivery", () => {
  it("waits for both native children and announces the settled transition only once", () => {
    const busy = { ...settled, activities: started };
    const firstDone = { ...busy, activities: [...started, completed("a")] };
    const done = { ...firstDone, activities: [...firstDone.activities, completed("b")] };
    expect(
      collectCompletedThreadCandidates(
        [
          {
            ...settled,
            latestTurn: { ...settled.latestTurn!, completedAt: null, state: "running" },
          },
        ],
        [busy],
      ),
    ).toEqual([]);
    expect(collectCompletedThreadCandidates([busy], [firstDone])).toEqual([]);
    expect(
      collectCompletedThreadCandidates([firstDone], [done]).map((candidate) => candidate.turnId),
    ).toEqual([turnId]);
    expect(collectCompletedThreadCandidates([done], [done])).toEqual([]);
  });
  it("retires old tasks across session teardown and restart without claiming success", () => {
    const activities = [...started, makeActivity({ kind: "background-work.reset", sequence: 7 })];
    expect(deriveBackgroundWork({ activities, turnId, sessionStatus: "ready" })).toEqual({
      taskIds: [],
      failed: true,
      settledAt: null,
    });
    expect(
      collectCompletedThreadCandidates(
        [{ ...settled, activities: started }],
        [{ ...settled, activities }],
      ),
    ).toEqual([]);
  });
  it("does not announce failed background work as successful", () => {
    expect(
      collectCompletedThreadCandidates(
        [{ ...settled, activities: started }],
        [{ ...settled, activities: [...started, completed("a"), completed("b", "failed")] }],
      ),
    ).toEqual([]);
  });
  it("does not let an earlier turn's unfinished tasks pin a new completion", () => {
    const next = {
      ...settled,
      latestTurn: { ...settled.latestTurn!, turnId: TurnId.makeUnsafe("next") },
      activities: started,
    };
    expect(
      collectCompletedThreadCandidates([{ ...settled, activities: started }], [next]),
    ).toHaveLength(1);
  });
});

it("carries owned tasks across background replies until all complete", () => {
  const wakeTurn = TurnId.makeUnsafe("wake");
  const boundary = makeActivity({
    kind: "response.started",
    turnId: wakeTurn,
    payload: { backgroundParentTurnId: turnId },
    sequence: 6,
  });
  const firstDone = {
    ...settled,
    latestTurn: { ...settled.latestTurn!, turnId: wakeTurn },
    activities: [...started, completed("a"), boundary],
  };
  expect(
    deriveBackgroundWork({ activities: firstDone.activities, turnId: wakeTurn }).taskIds,
  ).toEqual(["b"]);
  expect(
    collectCompletedThreadCandidates([{ ...settled, activities: started }], [firstDone]),
  ).toEqual([]);
  const done = {
    ...firstDone,
    activities: [...firstDone.activities, { ...completed("b"), sequence: 7 }],
  };
  expect(collectCompletedThreadCandidates([firstDone], [done])).toHaveLength(1);
  expect(collectCompletedThreadCandidates([done], [done])).toEqual([]);
});
