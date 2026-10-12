import { Effect, Option } from "effect";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ProjectionPendingInteractionRepository } from "../persistence/Services/ProjectionPendingInteractions.ts";
import {
  ApprovalRequestId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { describe, expect, it, vi } from "vitest";

import {
  planRestartTurnReconciliation,
  reconcileRestartStuckTurns,
  type ReconcilablePendingInteraction,
  type ReconcilableThread,
} from "./startupTurnReconciliation.ts";

const NOW = "2026-06-14T10:00:00.000Z";

const makeThread = (
  id: string,
  overrides: Partial<Omit<ReconcilableThread, "id">> = {},
): ReconcilableThread => ({
  id: ThreadId.makeUnsafe(id),
  runtimeMode: "full-access",
  session: null,
  latestTurn: null,
  ...overrides,
});

const makeSession = (
  threadId: string,
  overrides: Partial<NonNullable<ReconcilableThread["session"]>> = {},
): NonNullable<ReconcilableThread["session"]> => ({
  threadId: ThreadId.makeUnsafe(threadId),
  status: "running",
  providerName: "codex",
  runtimeMode: "approval-required",
  activeTurnId: TurnId.makeUnsafe(`${threadId}-turn`),
  lastError: null,
  updatedAt: "2026-06-13T09:00:00.000Z",
  ...overrides,
});

const makeActivity = (
  id: string,
  kind: string,
  payload: NonNullable<ReconcilableThread["activities"]>[number]["payload"],
  sequence: number,
): NonNullable<ReconcilableThread["activities"]>[number] => ({
  id: EventId.makeUnsafe(id),
  kind,
  payload,
  sequence,
  createdAt: `2026-06-13T09:00:0${sequence}.000Z`,
});

const makePendingInteraction = (
  threadId: string,
  interactionKind: ReconcilablePendingInteraction["interactionKind"],
  requestId: string,
  status: ReconcilablePendingInteraction["status"],
): ReconcilablePendingInteraction => ({
  threadId: ThreadId.makeUnsafe(threadId),
  interactionKind,
  requestId: ApprovalRequestId.makeUnsafe(requestId),
  status,
});

const expectSessionCommands = (commands: ReturnType<typeof planRestartTurnReconciliation>) =>
  commands.map((command) => {
    expect(command.type).toBe("thread.session.set");
    if (command.type !== "thread.session.set") {
      throw new Error(`expected thread.session.set command, got ${command.type}`);
    }
    return command;
  });

describe("planRestartTurnReconciliation", () => {
  it("leaves clean threads untouched (no active turn, no in-flight session, no open turn)", () => {
    const threads = [
      makeThread("idle-no-session"),
      makeThread("ready", {
        session: makeSession("ready", { status: "ready", activeTurnId: null }),
        latestTurn: { state: "completed" },
      }),
      makeThread("stopped", {
        session: makeSession("stopped", { status: "stopped", activeTurnId: null }),
        latestTurn: { state: "interrupted" },
      }),
      makeThread("errored", {
        session: makeSession("errored", {
          status: "error",
          activeTurnId: null,
          lastError: "boom",
        }),
        latestTurn: { state: "error" },
      }),
    ];

    expect(planRestartTurnReconciliation({ threads, now: NOW })).toEqual([]);
  });

  it.each([
    ["pending", true],
    ["confirmed", false],
    ["uncertain", true],
  ] as const)(
    "treats a %s projected approval according to restart callback state",
    (status, stale) => {
      const thread = makeThread(`projected-${status}`, {
        session: makeSession(`projected-${status}`, { status: "ready", activeTurnId: null }),
        latestTurn: { state: "completed" },
        pendingInteractions: [
          {
            interactionKind: "approval",
            requestId: ApprovalRequestId.makeUnsafe(`approval-${status}`),
            lifecycleGeneration: "generation-a",
            status,
            createdAt: "2026-06-13T09:00:01.000Z",
          },
        ],
      });

      const commands = planRestartTurnReconciliation({ threads: [thread], now: NOW });
      if (!stale) {
        expect(commands).toEqual([]);
        return;
      }
      expect(commands).toEqual([
        expect.objectContaining({
          type: "thread.activity.append",
          activity: expect.objectContaining({
            payload: expect.objectContaining({
              requestId: `approval-${status}`,
              lifecycleGeneration: "generation-a",
            }),
          }),
        }),
      ]);
    },
  );

  it("does not replay stale activities when a present projection is empty", () => {
    const thread = makeThread("projected-empty", {
      session: makeSession("projected-empty", { status: "ready", activeTurnId: null }),
      latestTurn: { state: "completed" },
      activities: [
        makeActivity(
          "legacy-looking-approval",
          "approval.requested",
          { requestId: "approval-absent-from-projection", requestKind: "command" },
          1,
        ),
      ],
      pendingInteractions: [],
    });

    expect(planRestartTurnReconciliation({ threads: [thread], now: NOW })).toEqual([]);
  });

  it("marks an unfinished checkpoint revert as failed after restart", () => {
    const thread = makeThread("stale-checkpoint-revert", {
      activities: [
        makeActivity(
          "checkpoint-revert-started",
          "checkpoint.revert.started",
          { turnCount: 1, scope: "thread" },
          1,
        ),
      ],
    });

    expect(planRestartTurnReconciliation({ threads: [thread], now: NOW })).toEqual([
      expect.objectContaining({
        type: "thread.activity.append",
        threadId: "stale-checkpoint-revert",
        activity: expect.objectContaining({ kind: "checkpoint.revert.failed" }),
      }),
    ]);
  });

  it("cleans stale requests from a terminal error without overwriting the error session", () => {
    const threads = [
      makeThread("errored-with-requests", {
        session: makeSession("errored-with-requests", {
          status: "error",
          activeTurnId: TurnId.makeUnsafe("failed-turn"),
          lastError: "runtime exploded",
        }),
        latestTurn: { state: "error" },
        activities: [
          makeActivity(
            "approval-requested-after-error",
            "approval.requested",
            {
              requestId: "approval-after-error",
              requestKind: "command",
            },
            1,
          ),
          makeActivity(
            "input-requested-after-error",
            "user-input.requested",
            {
              requestId: "input-after-error",
              questions: [
                {
                  id: "next_step",
                  header: "Next",
                  question: "How should the failed turn continue?",
                  options: [
                    {
                      label: "Cancel",
                      description: "Stop the stale request.",
                    },
                  ],
                },
              ],
            },
            2,
          ),
        ],
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });
    expect(commands.map((command) => command.type)).toEqual([
      "thread.activity.append",
      "thread.activity.append",
      "thread.session.set",
    ]);
    expect(commands[0]).toMatchObject({
      commandId: `restart-reconcile:errored-with-requests:approval:approval-after-error:${NOW}`,
    });
    expect(commands[1]).toMatchObject({
      commandId: `restart-reconcile:errored-with-requests:user-input:input-after-error:${NOW}`,
    });

    expect(commands[2]).toEqual({
      type: "thread.session.set",
      commandId: `restart-reconcile-active-turn:errored-with-requests:${NOW}`,
      threadId: "errored-with-requests",
      createdAt: NOW,
      session: {
        threadId: "errored-with-requests",
        status: "error",
        providerName: "codex",
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: "runtime exploded",
        updatedAt: NOW,
      },
    });
  });

  it("completes assistant messages the dead runtime left streaming before interrupting", () => {
    const turnId = TurnId.makeUnsafe("streaming-turn");
    const thread = makeThread("streaming", {
      session: makeSession("streaming", { activeTurnId: turnId }),
      latestTurn: { state: "running" },
      messages: [
        { id: MessageId.makeUnsafe("user"), role: "user", streaming: false, turnId },
        { id: MessageId.makeUnsafe("done"), role: "assistant", streaming: false, turnId },
        { id: MessageId.makeUnsafe("cut-off"), role: "assistant", streaming: true, turnId },
      ],
    });

    const commands = planRestartTurnReconciliation({ threads: [thread], now: NOW });
    expect(commands.map((command) => command.type)).toEqual([
      "thread.message.assistant.complete",
      "thread.session.set",
    ]);
    expect(commands[0]).toEqual({
      type: "thread.message.assistant.complete",
      commandId: `restart-reconcile-message:streaming:cut-off:${NOW}`,
      threadId: "streaming",
      messageId: "cut-off",
      turnId,
      createdAt: NOW,
    });
  });

  it("reconciles a thread whose session still points at an active turn", () => {
    const threads = [
      makeThread("stuck", {
        session: makeSession("stuck", {
          status: "running",
          activeTurnId: TurnId.makeUnsafe("stuck-turn"),
        }),
        latestTurn: { state: "running" },
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command).toEqual({
      type: "thread.session.set",
      commandId: `restart-reconcile:stuck:${NOW}`,
      threadId: "stuck",
      createdAt: NOW,
      session: {
        threadId: "stuck",
        status: "interrupted",
        providerName: "codex",
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });
  });

  it("resolves stale pending approval and user-input requests before interrupting the session", () => {
    const threads = [
      makeThread("stuck-with-requests", {
        session: makeSession("stuck-with-requests", {
          status: "running",
          activeTurnId: TurnId.makeUnsafe("stuck-with-requests-turn"),
        }),
        latestTurn: { state: "running" },
        activities: [
          makeActivity(
            "approval-requested",
            "approval.requested",
            {
              requestId: "approval-1",
              requestKind: "command",
            },
            1,
          ),
          makeActivity(
            "approval-requested-resolved",
            "approval.requested",
            {
              requestId: "approval-resolved",
              requestKind: "command",
            },
            2,
          ),
          makeActivity(
            "approval-resolved",
            "approval.resolved",
            {
              requestId: "approval-resolved",
              decision: "cancel",
            },
            3,
          ),
          makeActivity(
            "user-input-requested",
            "user-input.requested",
            {
              requestId: "input-1",
              questions: [
                {
                  id: "next_step",
                  header: "Next",
                  question: "How should the recovered turn continue?",
                  options: [
                    {
                      label: "Cancel",
                      description: "Stop the stale request.",
                    },
                  ],
                },
              ],
            },
            4,
          ),
          makeActivity(
            "user-input-requested-resolved",
            "user-input.requested",
            {
              requestId: "input-resolved",
              questions: [
                {
                  id: "next_step",
                  header: "Next",
                  question: "How should the recovered turn continue?",
                  options: [
                    {
                      label: "Cancel",
                      description: "Stop the stale request.",
                    },
                  ],
                },
              ],
            },
            5,
          ),
          makeActivity(
            "user-input-resolved",
            "user-input.resolved",
            {
              requestId: "input-resolved",
              answers: {},
            },
            6,
          ),
        ],
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });

    expect(commands.map((command) => command.type)).toEqual([
      "thread.activity.append",
      "thread.activity.append",
      "thread.session.set",
    ]);
    expect(commands[0]).toMatchObject({
      type: "thread.activity.append",
      commandId: `restart-reconcile:stuck-with-requests:approval:approval-1:${NOW}`,
      threadId: "stuck-with-requests",
      activity: {
        kind: "provider.approval.respond.failed",
        payload: {
          requestId: "approval-1",
          detail: expect.stringContaining("Stale pending approval request: approval-1"),
        },
      },
    });
    expect(commands[1]).toMatchObject({
      type: "thread.activity.append",
      commandId: `restart-reconcile:stuck-with-requests:user-input:input-1:${NOW}`,
      threadId: "stuck-with-requests",
      activity: {
        kind: "provider.user-input.respond.failed",
        payload: {
          requestId: "input-1",
          detail: expect.stringContaining("Stale pending user-input request: input-1"),
        },
      },
    });
    expect(commands[2]).toMatchObject({
      type: "thread.session.set",
      threadId: "stuck-with-requests",
      session: {
        status: "interrupted",
        activeTurnId: null,
      },
    });
  });

  it("reconciles an in-flight session even with no active turn id (starting/running)", () => {
    const threads = [
      makeThread("starting", {
        session: makeSession("starting", { status: "starting", activeTurnId: null }),
      }),
      makeThread("running-no-turn", {
        session: makeSession("running-no-turn", { status: "running", activeTurnId: null }),
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });
    const sessionCommands = expectSessionCommands(commands);
    expect(sessionCommands.map((command) => command.threadId)).toEqual([
      "starting",
      "running-no-turn",
    ]);
    expect(sessionCommands.every((command) => command.session.activeTurnId === null)).toBe(true);
    expect(sessionCommands.every((command) => command.session.status === "interrupted")).toBe(true);
  });

  it("heals an open turn projection even when the session already looks terminal", () => {
    const threads = [
      makeThread("orphan-turn", {
        session: makeSession("orphan-turn", { status: "interrupted", activeTurnId: null }),
        latestTurn: { state: "running" },
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.threadId).toBe("orphan-turn");
  });

  it("falls back to the thread runtime mode and a null provider when no session row exists", () => {
    const threads = [
      makeThread("no-session-open-turn", {
        runtimeMode: "approval-required",
        session: null,
        latestTurn: { state: "running" },
      }),
    ];

    const commands = planRestartTurnReconciliation({ threads, now: NOW });
    expect(commands).toHaveLength(1);
    const sessionCommands = expectSessionCommands(commands);
    expect(sessionCommands[0]?.session).toMatchObject({
      providerName: null,
      runtimeMode: "approval-required",
      status: "interrupted",
      activeTurnId: null,
    });
  });

  it("ignores resolved rows and rows belonging to other threads", () => {
    const thread = makeThread("clean-thread", {
      session: makeSession("clean-thread", { status: "ready", activeTurnId: null }),
      latestTurn: { state: "completed" },
    });
    const pendingInteractions: ReadonlyArray<ReconcilablePendingInteraction> = [
      makePendingInteraction("clean-thread", "userInput", "answered", "confirmed"),
      makePendingInteraction("other-thread", "userInput", "elsewhere", "pending"),
    ];

    expect(
      planRestartTurnReconciliation({ threads: [thread], pendingInteractions, now: NOW }),
    ).toEqual([]);
  });
});

describe("reconcileRestartStuckTurns selection", () => {
  it.each(["uncertain"] as const)(
    "finds %s callbacks on completed threads even with false summary flags",
    async (status) => {
      const thread = {
        ...makeThread("orphan", {
          session: makeSession("orphan", { status: "ready", activeTurnId: null }),
          latestTurn: { state: "completed" },
        }),
        activities: [],
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      };
      const row = {
        interactionKind: "userInput" as const,
        requestId: ApprovalRequestId.makeUnsafe("orphaned-question"),
        threadId: thread.id,
        lifecycleGeneration: "lost-runtime",
        status,
        createdAt: NOW,
      };
      const dispatch = vi.fn(() => Effect.void);
      const getThreadDetailById = vi.fn(() =>
        Effect.succeed(Option.some({ ...thread, pendingInteractions: [row] })),
      );
      await Effect.runPromise(
        reconcileRestartStuckTurns.pipe(
          Effect.provideService(OrchestrationEngineService, {
            getReadModel: () =>
              Effect.succeed({ threads: [thread, makeThread("untouched", { activities: [] })] }),
            dispatch,
          } as never),
          Effect.provideService(ProjectionSnapshotQuery, { getThreadDetailById } as never),
          Effect.provideService(ProjectionPendingInteractionRepository, {
            listUnsettled: () => Effect.succeed([row]),
          } as never),
        ),
      );
      expect(getThreadDetailById).toHaveBeenCalledExactlyOnceWith(thread.id);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: "thread.activity.append",
          activity: expect.objectContaining({
            payload: expect.objectContaining({
              requestId: row.requestId,
              lifecycleGeneration: "lost-runtime",
            }),
          }),
        }),
      );
    },
  );
});
