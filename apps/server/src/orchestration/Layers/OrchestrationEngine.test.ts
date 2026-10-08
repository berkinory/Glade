import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { Effect, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { ORCHESTRATION_EVENT_PUBSUB_CAPACITY } from "../orchestrationAdmission.ts";
import {
  createOrchestrationSystem,
  createProjectCommand,
  createThreadCommand,
  now,
  seedProjectAndThread,
} from "../testing/orchestrationEngineSystem.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

describe("OrchestrationEngine", () => {
  it.each([false, true])(
    "persists async questions and admits one concurrent answer (running=%s)",
    async (running) => {
      const system = await createOrchestrationSystem();
      const { engine } = system;
      const createdAt = now();
      const threadId = ThreadId.makeUnsafe("async-question-thread");
      const projectId = "async-question-project";
      const questionId = asMessageId("assistant:async-question");
      const turnId = asTurnId("question-turn");
      let index = 0;
      const commandId = () => CommandId.makeUnsafe(`async-question-${++index}`);
      const questions = [
        { title: "When does it happen?", options: ["On launch", "On reconnect"] },
        { title: "Any other details?" },
      ];
      try {
        await seedProjectAndThread(system, { projectId, threadId, createdAt });
        await system.run(
          engine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: commandId(),
            threadId,
            messageId: questionId,
            turnId,
            delta: "When does it happen?",
            createdAt,
          }),
        );
        const completeQuestion = () =>
          engine.dispatch({
            type: "thread.message.assistant.complete",
            commandId: commandId(),
            threadId,
            messageId: questionId,
            turnId,
            asyncQuestions: questions,
            createdAt,
          });
        await system.run(completeQuestion());
        await system.run(
          engine.dispatch({
            type: "thread.session.set",
            commandId: commandId(),
            threadId,
            session: {
              threadId,
              providerName: "codex",
              status: running ? "running" : "ready",
              activeTurnId: running ? turnId : null,
              runtimeMode: "approval-required",
              lastError: null,
              updatedAt: createdAt,
            },
            createdAt,
          }),
        );
        const before = (await system.run(engine.getReadModel())).threads[0]!;
        expect(
          before.messages.find((message) => message.id === questionId)?.asyncUserInput,
        ).toEqual({ questions });
        expect(before.activities.some((activity) => activity.kind === "user-input.requested")).toBe(
          false,
        );
        const answer = (suffix: string, answers = ["On reconnect", "Only after sleep"]) =>
          engine.dispatch({
            type: "thread.turn.start",
            commandId: commandId(),
            threadId,
            message: {
              messageId: asMessageId(`answer-${suffix}`),
              role: "user",
              text: "client placeholder",
              attachments: [],
            },
            asyncUserInputResponse: { messageId: questionId, answers },
            dispatchMode: "queue",
            runtimeMode: "full-access",
            createdAt: new Date(Date.parse(createdAt) + 60_000).toISOString(),
          });
        await expect(system.run(answer("invalid", ["Only one answer"]))).rejects.toThrow(
          "one answer per question",
        );
        const attempts = await Promise.allSettled([
          system.run(answer("first")),
          system.run(answer("duplicate")),
        ]);
        expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
        const rejected = attempts.find((attempt) => attempt.status === "rejected");
        expect(rejected?.status === "rejected" && String(rejected.reason)).toContain(
          "already been answered",
        );
        const answeredThread = (await system.run(engine.getReadModel())).threads[0]!;
        expect(
          answeredThread.messages.find((message) => message.id === questionId)?.updatedAt,
        ).toBe(createdAt);
        await system.run(completeQuestion()); // A replay must not reopen the answered card.
        const after = (await system.run(engine.getReadModel())).threads[0]!;
        const response = after.messages.find((message) => message.id === questionId)?.asyncUserInput
          ?.response;
        expect(response?.answers).toEqual(["On reconnect", "Only after sleep"]);
        const answers = after.messages.filter((message) => message.role === "user");
        expect(answers).toHaveLength(1);
        expect(answers[0]).toMatchObject({
          id: response?.messageId,
          text: "When does it happen?\nOn reconnect\n\nAny other details?\nOnly after sleep",
          dispatchMode: "steer",
          startsNewTurn: !running,
        });
        expect(after.runtimeMode).toBe("approval-required");
        expect(after.session?.status).toBe(running ? "running" : "starting");
      } finally {
        await system.dispose();
      }
    },
  );

  it("keeps a second checkpoint revert protected after a failed revert with a higher runtime sequence", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();
    const projectId = "project-revert-sequence";
    const threadId = ThreadId.makeUnsafe("thread-revert-sequence");
    let commandIndex = 0;
    const commandId = () => CommandId.makeUnsafe(`revert-sequence-${++commandIndex}`);
    const appendActivity = (kind: string, sequence?: number) =>
      system.run(
        engine.dispatch({
          type: "thread.activity.append",
          commandId: commandId(),
          threadId,
          activity: {
            id: EventId.makeUnsafe(`revert-sequence-activity-${commandIndex}`),
            kind,
            tone: "info",
            summary: kind,
            payload: {},
            turnId: null,
            ...(sequence === undefined ? {} : { sequence }),
            createdAt,
          },
          createdAt,
        }),
      );
    const revert = () =>
      system.run(
        engine.dispatch({
          type: "thread.checkpoint.revert",
          commandId: commandId(),
          threadId,
          turnCount: 1,
          createdAt,
        }),
      );

    try {
      await seedProjectAndThread(system, {
        projectId,
        threadId,
        createdAt,
        runtimeMode: "full-access",
      });
      await appendActivity("tool.completed", 1_000);
      await revert();
      await appendActivity("checkpoint.revert.failed");
      await revert();

      await expect(
        system.run(
          engine.dispatch({
            type: "thread.delete",
            commandId: commandId(),
            threadId,
          }),
        ),
      ).rejects.toThrow("checkpoint revert in progress");
      await expect(
        system.run(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: commandId(),
            threadId,
            message: {
              messageId: asMessageId("message-during-revert"),
              role: "user",
              text: "Continue",
              attachments: [],
            },
            runtimeMode: "full-access",
            createdAt,
          }),
        ),
      ).rejects.toThrow("checkpoint revert in progress");
      await expect(revert()).rejects.toThrow("checkpoint revert in progress");
    } finally {
      await system.dispose();
    }
  });

  it("preserves large Unicode responses and segment boundaries through completion", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();
    const threadId = ThreadId.makeUnsafe("thread-large-response");
    const messageId = asMessageId("message-large-response");
    try {
      await seedProjectAndThread(system, { projectId: "large-project", threadId, createdAt });

      const chunks = [
        "é漢😀".repeat(30_000),
        `${"é漢😀".repeat(30_000)}\nSecond segment \ud83d`,
        "\ude80 done",
      ];
      for (const [index, delta] of chunks.entries()) {
        await system.run(
          engine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: CommandId.makeUnsafe(`large-delta-${index}`),
            threadId,
            messageId,
            delta,
            ...(index < 2 ? { segmentStartedAt: createdAt, segmentSequence: index + 1 } : {}),
            createdAt,
          }),
        );
      }
      await system.run(
        engine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: CommandId.makeUnsafe("large-complete"),
          threadId,
          messageId,
          createdAt,
        }),
      );
      const expected = chunks.join("");
      const events = await system.run(Stream.runCollect(engine.readEvents(0)));
      const completed = Array.from(events).findLast(
        (event) => event.type === "thread.message-sent",
      );
      expect(completed?.payload).toMatchObject({ streaming: false, text: expected });
      const model = await system.run(engine.getReadModel());
      const message = model.threads.find((thread) => thread.id === threadId)?.messages[0];
      expect(message?.text).toBe(expected);
      expect(message?.textSegments?.map((segment) => segment.text)).toEqual([
        chunks[0],
        chunks.slice(1).join(""),
      ]);
    } finally {
      await system.dispose();
    }
  });

  it("quiesces normal admission while draining reserved lifecycle commands", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const threadId = ThreadId.makeUnsafe("thread-engine-quiesce");

    await seedProjectAndThread(system, {
      projectId: "project-engine-quiesce",
      threadId,
      createdAt,
    });

    await system.run(system.engine.quiesce);
    const diagnostic = {
      type: "thread.activity.append",
      commandId: CommandId.makeUnsafe("cmd-engine-quiesce-diagnostic"),
      threadId,
      activity: {
        id: EventId.makeUnsafe("engine-quiesce-diagnostic"),
        tone: "error",
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        payload: { detail: "Provider rejected the interrupt during shutdown." },
        turnId: null,
        createdAt,
      },
      createdAt,
    } as const;
    await expect(system.run(system.engine.dispatch(diagnostic))).resolves.toMatchObject({
      sequence: expect.any(Number),
    });
    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-normal"),
          threadId,
          title: "Rejected after quiesce",
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-turn-start"),
          threadId,
          message: {
            messageId: MessageId.makeUnsafe("msg-engine-quiesce-turn-start"),
            role: "user",
            text: "Rejected after quiesce",
            attachments: [],
          },
          runtimeMode: "approval-required",
          createdAt,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-control"),
          threadId,
          createdAt,
        }),
      ),
    ).resolves.toMatchObject({ sequence: expect.any(Number) });
    await system.run(system.engine.drain);
    await system.run(system.engine.stop);

    await expect(
      system.run(
        system.engine.dispatch({
          ...diagnostic,
          commandId: CommandId.makeUnsafe("cmd-engine-stopped-diagnostic"),
        }),
      ),
    ).rejects.toMatchObject({ _tag: "OrchestrationCommandAdmissionError", reason: "stopped" });

    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.makeUnsafe("cmd-engine-stopped-control"),
          threadId,
          createdAt,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    await system.dispose();
  });

  it("returns the original result for an equal retry and rejects unequal command-ID reuse", async () => {
    const system = await createOrchestrationSystem();
    const command = {
      type: "project.create" as const,
      commandId: CommandId.makeUnsafe("cmd-fingerprint-retry"),
      projectId: asProjectId("project-fingerprint-retry"),
      title: "Fingerprint project",
      workspaceRoot: "/tmp/project-fingerprint-retry",
      defaultModelSelection: null,
      createdAt: "2026-07-14T00:00:00.000Z",
    };

    const first = await system.run(system.engine.dispatch(command));
    await expect(system.run(system.engine.dispatch({ ...command }))).resolves.toEqual(first);
    await expect(
      system.run(
        system.engine.dispatch({
          ...command,
          title: "Different command content",
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandIdentityCollisionError",
      commandId: command.commandId,
    });

    const events = await system.run(Stream.runCollect(system.engine.readEvents(0)));
    expect(Array.from(events)).toHaveLength(1);
    expect(
      Array.from(events).filter((event) => event.commandId === command.commandId),
    ).toHaveLength(1);
    expect((await system.run(system.engine.getReadModel())).projects[0]?.title).toBe(
      "Fingerprint project",
    );
    await system.dispose();
  });

  it("claims managed attachments atomically and rejects attachment changes on an accepted retry", async () => {
    const createdAt = now();
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const threadId = ThreadId.makeUnsafe("thread-managed-attachment");
    const commandId = CommandId.makeUnsafe("cmd-managed-attachment-turn");
    const messageId = asMessageId("msg-managed-attachment");
    const principal = { ownerKind: "session" as const, ownerId: "session-a" };

    await seedProjectAndThread(system, {
      projectId: "project-managed-attachment",
      threadId,
      createdAt,
    });

    const repository = system.managedAttachmentRepository;
    const stage = async (attachmentId: string) => {
      const reserved = await system.run(
        repository.reserve({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: principal.ownerKind,
          ownerId: principal.ownerId,
          kind: "image",
          originalName: `${attachmentId}.png`,
          mimeType: "image/png",
          reservedBytes: 1,
          relativePath: `objects/aa/${attachmentId}.png`,
          now: createdAt,
        }),
      );
      expect(reserved.status).toBe("reserved");
      await system.run(
        repository.finalizeStaged({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: principal.ownerKind,
          ownerId: principal.ownerId,
          sizeBytes: 1,
          sha256: "a".repeat(64),
          stagingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          now: createdAt,
        }),
      );
    };
    const firstAttachmentId = "att_v2_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const secondAttachmentId = "att_v2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await stage(firstAttachmentId);
    await stage(secondAttachmentId);

    const command = {
      type: "thread.turn.start" as const,
      commandId,
      threadId,
      message: {
        messageId,
        role: "user" as const,
        text: "inspect",
        attachments: [
          {
            type: "image" as const,
            id: firstAttachmentId,
            name: "client-value-is-not-authoritative.png",
            mimeType: "image/png",
            sizeBytes: 1,
          },
        ],
      },
      runtimeMode: "approval-required" as const,
      createdAt,
    };
    const accepted = await system.run(engine.dispatch(command, { attachmentPrincipal: principal }));
    await expect(
      system.run(engine.dispatch(command, { attachmentPrincipal: principal })),
    ).resolves.toEqual(accepted);

    for (let attempt = 0; attempt < 2; attempt += 1)
      await expect(
        system.run(engine.dispatch(command, { attachmentPrincipal: principal, settleOnly: true })),
      ).resolves.toEqual(accepted);
    await expect(
      system.run(
        engine.dispatch(command, {
          attachmentPrincipal: { ownerKind: "session", ownerId: "different-session" },
          settleOnly: true,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "OrchestrationCommandIdentityCollisionError" });

    const editResendClaim = await system.run(
      repository.claimForAcceptedTurn({
        attachmentIds: [firstAttachmentId],
        ownerThreadId: threadId,
        ownerKind: principal.ownerKind,
        ownerId: principal.ownerId,
        commandId: "cmd-attachment-edit-resend",
        messageId,
        now: new Date().toISOString(),
      }),
    );
    expect(editResendClaim.status).toBe("claimed");
    await expect(
      system.run(engine.dispatch(command, { attachmentPrincipal: principal })),
    ).resolves.toEqual(accepted);

    await expect(
      system.run(
        engine.dispatch(
          {
            ...command,
            message: {
              ...command.message,
              attachments: [{ ...command.message.attachments[0]!, id: secondAttachmentId }],
            },
          },
          { attachmentPrincipal: principal },
        ),
      ),
    ).rejects.toThrow("Command identity collision");

    const claimed = await system.run(repository.findClaimedForCommand({ commandId }));
    expect(claimed.map((attachment) => attachment.attachmentId)).toEqual([firstAttachmentId]);
    await system.dispose();
  });

  it("serializes settlement before late dispatch and binds its durable verdict to caller and content", async () => {
    const system = await createOrchestrationSystem();
    const command = {
      type: "thread.turn.start" as const,
      commandId: CommandId.makeUnsafe("settlement-before-dispatch"),
      threadId: ThreadId.makeUnsafe("settlement-thread"),
      message: {
        messageId: asMessageId("settlement-message"),
        role: "user" as const,
        text: "hello",
        attachments: [],
      },
      runtimeMode: "approval-required" as const,
      createdAt: now(),
    };
    const attachmentPrincipal = { ownerKind: "session" as const, ownerId: "original-caller" };
    try {
      for (const settleOnly of [true, true, false]) {
        await expect(
          system.run(system.engine.dispatch(command, { attachmentPrincipal, settleOnly })),
        ).rejects.toMatchObject({ _tag: "OrchestrationCommandPreviouslyRejectedError" });
      }
      await expect(
        system.run(
          system.engine.dispatch(command, {
            attachmentPrincipal: { ownerKind: "session", ownerId: "different-caller" },
            settleOnly: true,
          }),
        ),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandIdentityCollisionError" });
      await expect(
        system.run(
          system.engine.dispatch(
            { ...command, message: { ...command.message, text: "changed" } },
            {
              attachmentPrincipal,
              settleOnly: true,
            },
          ),
        ),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandIdentityCollisionError" });
      expect(
        Array.from(await system.run(Stream.runCollect(system.engine.readEvents(0)))),
      ).toHaveLength(0);
      await system.run(system.engine.quiesce);
      await expect(
        system.run(system.engine.dispatch(command, { attachmentPrincipal, settleOnly: true })),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandPreviouslyRejectedError" });
      await system.run(system.engine.stop);
      await expect(
        system.run(system.engine.dispatch(command, { attachmentPrincipal, settleOnly: true })),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandAdmissionError", reason: "stopped" });
    } finally {
      await system.dispose();
    }
  });

  it("keeps dispatch responsive and replays every event when a subscriber falls behind", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const projectId = "project-slow-subscriber";

    const count = ORCHESTRATION_EVENT_PUBSUB_CAPACITY + 510;
    try {
      const initial = await system.run(
        engine.dispatch(createProjectCommand({ projectId, createdAt: now() })),
      );
      const result = await system.run(
        Effect.gen(function* () {
          const live = yield* engine.subscribeDomainEvents;
          for (let i = 0; i < count; i++) {
            yield* engine.dispatch({
              type: "project.meta.update",
              commandId: CommandId.makeUnsafe(`cmd-slow-subscriber-${i}`),
              projectId: asProjectId(projectId),
              title: `Update ${i}`,
            });
          }
          return Array.from(yield* Stream.runCollect(Stream.take(live, count)));
        }).pipe(Effect.scoped, Effect.timeoutOption("8 seconds")),
      );
      expect(Option.isSome(result)).toBe(true);
      const events = Option.getOrThrow(result);
      expect(events.map((event) => event.sequence)).toEqual(
        Array.from({ length: count }, (_, i) => initial.sequence + i + 1),
      );
      expect(events.at(-1)?.payload).toMatchObject({ title: `Update ${count - 1}` });
    } finally {
      await system.dispose();
    }
  }, 15_000);

  it("stores completed checkpoint summaries even when no files changed", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await seedProjectAndThread(system, {
      projectId: "project-turn-diff",
      threadId: "thread-turn-diff",
      createdAt,
    });
    await system.run(
      engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.makeUnsafe("cmd-turn-diff-complete"),
        threadId: ThreadId.makeUnsafe("thread-turn-diff"),
        turnId: asTurnId("turn-1"),
        completedAt: createdAt,
        checkpointRef: asCheckpointRef("refs/glade/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    );

    const thread = (await system.run(engine.getReadModel())).threads.find(
      (entry) => entry.id === "thread-turn-diff",
    );
    expect(thread?.checkpoints).toEqual([
      {
        turnId: asTurnId("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: asCheckpointRef("refs/glade/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: createdAt,
      },
    ]);
    await system.dispose();
  });

  it("retires an empty existing project when re-adding the same workspace root", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const workspaceRoot = "/tmp/readd-project";
    try {
      await system.run(
        system.engine.dispatch(
          createProjectCommand({ projectId: "project-stale", workspaceRoot, createdAt }),
        ),
      );
      await expect(
        system.run(
          system.engine.dispatch(
            createProjectCommand({ projectId: "project-readd", workspaceRoot, createdAt }),
          ),
        ),
      ).resolves.toEqual({ sequence: 3 });

      const { projects } = await system.run(system.engine.getReadModel());
      expect(projects.find((project) => project.id === "project-stale")?.deletedAt).toBe(createdAt);
      expect(projects.find((project) => project.id === "project-readd")?.deletedAt).toBeNull();
    } finally {
      await system.dispose();
    }
  });

  it("keeps rejecting a duplicate workspace root when the existing project has threads", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    try {
      await seedProjectAndThread(system, {
        projectId: "project-active",
        threadId: "thread-active",
        createdAt,
      });
      await expect(
        system.run(
          system.engine.dispatch(
            createProjectCommand({
              projectId: "project-active-duplicate",
              workspaceRoot: "/tmp/project-active",
              createdAt,
            }),
          ),
        ),
      ).rejects.toThrow("already uses workspace root");
    } finally {
      await system.dispose();
    }
  });

  it("rejects duplicate thread creation", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const thread = { projectId: "project-duplicate", threadId: "thread-duplicate", createdAt };
    try {
      await seedProjectAndThread(system, thread);
      await expect(
        system.run(
          system.engine.dispatch(
            createThreadCommand({ ...thread, commandId: "cmd-thread-duplicate-2" }),
          ),
        ),
      ).rejects.toThrow("already exists");
    } finally {
      await system.dispose();
    }
  });
});
