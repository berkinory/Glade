import { CheckpointRef, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { gitQueryKeys } from "../lib/gitQueryOptions";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { useStore } from "../store";
import { initialState } from "../storeState";
import { makeActivity, makeDomainEvent, makeState, makeThread } from "../storeTestFixtures";
import { createStreamBatching } from "./-streamBatching";
import type { StreamContext } from "./-streamContracts";
import { createStreamState } from "./-streamState";

const threadA = makeThread({ id: ThreadId.makeUnsafe("thread-a") });
const threadB = makeThread({
  id: ThreadId.makeUnsafe("thread-b"),
  envMode: "worktree",
  worktreePath: "/tmp/worktree-b",
});
const cwdA = "/tmp/project";
const cwdB = "/tmp/worktree-b";

const trackedKeys = {
  "checkpoint A": providerQueryKeys.checkpointDiff({
    threadId: threadA.id,
    fromTurnCount: 0,
    toTurnCount: 1,
    ignoreWhitespace: false,
  }),
  "checkpoint B": providerQueryKeys.checkpointDiff({
    threadId: threadB.id,
    fromTurnCount: 0,
    toTurnCount: 1,
    ignoreWhitespace: false,
  }),
  "files A": projectQueryKeys.listDirectories(cwdA, null, true),
  "files B": projectQueryKeys.listDirectories(cwdB, null, true),
  "git A": gitQueryKeys.history(cwdA),
  "git B": gitQueryKeys.history(cwdB),
};

const turnDiffCompleted = makeDomainEvent("thread.turn-diff-completed", {
  threadId: threadA.id,
  turnId: TurnId.makeUnsafe("turn-1"),
  checkpointTurnCount: 1,
  checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
  status: "ready",
  files: [],
  assistantMessageId: null,
  completedAt: "2026-02-27T00:00:00.000Z",
});
const toolCompleted = makeDomainEvent("thread.activity-appended", {
  threadId: threadA.id,
  activity: makeActivity({ kind: "tool.completed" }),
});

afterEach(() => {
  useStore.setState(initialState);
});

describe("stream batching invalidation", () => {
  it.each<{
    name: string;
    event: OrchestrationEvent;
    watched: boolean;
    expected: (keyof typeof trackedKeys)[];
  }>([
    {
      name: "scoped turn diff invalidates only that thread's keys",
      event: turnDiffCompleted,
      watched: true,
      expected: ["checkpoint A", "files A", "git A"],
    },
    {
      name: "tool completion refreshes git for a cwd without a status watcher",
      event: toolCompleted,
      watched: false,
      expected: ["files A", "git A"],
    },
    {
      name: "tool completion leaves git to the status watcher",
      event: toolCompleted,
      watched: true,
      expected: ["files A"],
    },
  ])("$name", async ({ event, watched, expected }) => {
    const stateA = makeState(threadA);
    const stateB = makeState(threadB);
    useStore.setState({
      ...stateA,
      threadIds: [threadA.id, threadB.id],
      threadShellById: { ...stateA.threadShellById, ...stateB.threadShellById },
    });
    const queryClient = new QueryClient();
    for (const queryKey of Object.values(trackedKeys)) queryClient.setQueryData(queryKey, {});
    const unsubscribe = watched
      ? new QueryObserver(queryClient, {
          queryKey: gitQueryKeys.status(cwdA),
          queryFn: () => ({}),
          initialData: {},
          staleTime: Infinity,
        }).subscribe(() => undefined)
      : () => undefined;
    const context: Pick<StreamContext, "queryClient" | "applyOrchestrationEventsHotPath"> = {
      queryClient,
      applyOrchestrationEventsHotPath: useStore.getState().applyOrchestrationEventsHotPath,
    };
    const batching = createStreamBatching(context as StreamContext, createStreamState());

    batching.queueDomainEvent(event);
    batching.domainEventFlushThrottler.cancel();
    batching.flushPendingDomainEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const invalidated = Object.entries(trackedKeys)
      .filter(([, queryKey]) => queryClient.getQueryState(queryKey)?.isInvalidated)
      .map(([name]) => name);
    expect(invalidated).toEqual(expected);
    unsubscribe();
  });
});
