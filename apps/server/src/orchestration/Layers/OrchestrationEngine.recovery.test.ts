import { CommandId, MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  createOrchestrationSystem,
  createProjectCommand,
  createThreadCommand,
  makeInMemoryEventStore,
  now,
  projectionFailure,
  readAllEvents,
  seedProjectAndThread,
  stubProjectionPipeline,
} from "../testing/orchestrationEngineSystem.ts";

const fingerprintPoison = vi.hoisted(() => new Set<string>());

vi.mock("../commandFingerprint.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../commandFingerprint.ts")>();
  return {
    ...actual,
    fingerprintOrchestrationCommand: (command: OrchestrationCommand) => {
      if (fingerprintPoison.has(command.commandId)) {
        throw new TypeError("poisoned command fingerprint");
      }
      return actual.fingerprintOrchestrationCommand(command);
    },
  };
});

describe("OrchestrationEngine recovery", () => {
  it("keeps processing queued commands after a storage failure", async () => {
    const system = await createOrchestrationSystem({
      eventStore: makeInMemoryEventStore({ failFirstAppendFor: "cmd-flaky-1" }),
    });
    const createdAt = now();
    try {
      await system.run(
        system.engine.dispatch(createProjectCommand({ projectId: "project-flaky", createdAt })),
      );
      await expect(
        system.run(
          system.engine.dispatch(
            createThreadCommand({
              commandId: "cmd-flaky-1",
              threadId: "thread-flaky-fail",
              projectId: "project-flaky",
              createdAt,
            }),
          ),
        ),
      ).rejects.toThrow("failed unexpectedly");

      const result = await system.run(
        system.engine.dispatch(
          createThreadCommand({
            threadId: "thread-flaky-ok",
            projectId: "project-flaky",
            createdAt,
          }),
        ),
      );
      expect(result.sequence).toBe(2);
      expect((await system.run(system.engine.getReadModel())).snapshotSequence).toBe(2);
    } finally {
      await system.dispose();
    }
  });

  it("rolls back all events for a multi-event command when projection fails mid-dispatch", async () => {
    let shouldFailRequestedProjection = true;
    const system = await createOrchestrationSystem({
      projectionPipeline: stubProjectionPipeline({
        projectHotEventInCurrentTransaction: (event) => {
          if (
            shouldFailRequestedProjection &&
            event.commandId === "cmd-turn-start-atomic" &&
            event.type === "thread.turn-start-requested"
          ) {
            shouldFailRequestedProjection = false;
            return Effect.fail(projectionFailure("test.projection"));
          }
          return Effect.succeed({ deferredPhaseSettled: false, afterCommit: Effect.void });
        },
      }),
    });
    const createdAt = now();
    try {
      await seedProjectAndThread(system, {
        projectId: "project-atomic",
        threadId: "thread-atomic",
        createdAt,
      });
      const turnStartCommand = {
        type: "thread.turn.start" as const,
        commandId: CommandId.makeUnsafe("cmd-turn-start-atomic"),
        threadId: ThreadId.makeUnsafe("thread-atomic"),
        message: {
          messageId: MessageId.makeUnsafe("msg-atomic-1"),
          role: "user" as const,
          text: "hello",
          attachments: [],
        },
        runtimeMode: "approval-required" as const,
        createdAt,
      };

      await expect(system.run(system.engine.dispatch(turnStartCommand))).rejects.toThrow(
        "failed unexpectedly",
      );
      expect((await readAllEvents(system)).map((event) => event.type)).toEqual([
        "project.created",
        "thread.created",
      ]);
      expect((await system.run(system.engine.getReadModel())).snapshotSequence).toBe(2);

      const retryResult = await system.run(system.engine.dispatch(turnStartCommand));
      expect(retryResult.sequence).toBe(4);
      const eventsAfterRetry = await readAllEvents(system);
      expect(eventsAfterRetry.map((event) => event.type)).toEqual([
        "project.created",
        "thread.created",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(
        eventsAfterRetry.filter((event) => event.commandId === turnStartCommand.commandId),
      ).toHaveLength(2);
    } finally {
      await system.dispose();
    }
  });

  it("keeps processing later commands after an unexpected worker defect", async () => {
    let shouldDieProjection = true;
    const system = await createOrchestrationSystem({
      eventStore: makeInMemoryEventStore(),
      projectionPipeline: stubProjectionPipeline({
        projectMetadataEvent: (event) => {
          if (shouldDieProjection && event.commandId === "cmd-project-defect-1") {
            shouldDieProjection = false;
            return Effect.die("projection defect");
          }
          return Effect.void;
        },
      }),
    });
    const createdAt = now();
    try {
      await expect(
        system.run(
          system.engine.dispatch(
            createProjectCommand({
              commandId: "cmd-project-defect-1",
              projectId: "project-defect-1",
              createdAt,
            }),
          ),
        ),
      ).rejects.toThrow("failed unexpectedly");
      await expect(
        system.run(
          system.engine.dispatch(
            createProjectCommand({
              commandId: "cmd-project-defect-2",
              projectId: "project-defect-2",
              createdAt,
            }),
          ),
        ),
      ).resolves.toEqual(expect.objectContaining({ sequence: expect.any(Number) }));

      const eventsAfterRecovery = await readAllEvents(system);
      expect(eventsAfterRecovery.map((event) => event.commandId)).toEqual([
        "cmd-project-defect-1",
        "cmd-project-defect-2",
      ]);
      expect(eventsAfterRecovery.every((event) => event.type === "project.created")).toBe(true);
    } finally {
      await system.dispose();
    }
  });

  it("reconciles in-memory state when append persists but projection fails", async () => {
    let shouldFailProjection = true;
    const system = await createOrchestrationSystem({
      eventStore: makeInMemoryEventStore(),
      projectionPipeline: stubProjectionPipeline({
        projectHotEventInCurrentTransaction: (event) => {
          if (shouldFailProjection && event.commandId === "cmd-thread-meta-sync-fail") {
            shouldFailProjection = false;
            return Effect.fail(projectionFailure("test.projection"));
          }
          return Effect.succeed({ deferredPhaseSettled: false, afterCommit: Effect.void });
        },
      }),
    });
    const createdAt = now();
    try {
      await seedProjectAndThread(system, {
        projectId: "project-sync",
        threadId: "thread-sync",
        title: "sync-before",
        createdAt,
      });
      await expect(
        system.run(
          system.engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe("cmd-thread-meta-sync-fail"),
            threadId: ThreadId.makeUnsafe("thread-sync"),
            title: "sync-after-failed-projection",
          }),
        ),
      ).rejects.toThrow("failed unexpectedly");

      const readModelAfterFailure = await system.run(system.engine.getReadModel());
      expect(readModelAfterFailure.snapshotSequence).toBe(3);
      expect(
        readModelAfterFailure.threads.find((thread) => thread.id === "thread-sync")?.title,
      ).toBe("sync-after-failed-projection");
    } finally {
      await system.dispose();
    }
  });

  it("keeps projection health healthy when optional cursors do not exist yet", async () => {
    const system = await createOrchestrationSystem();
    try {
      await system.run(
        system.engine.dispatch(
          createProjectCommand({ projectId: "project-health-fresh", createdAt: now() }),
        ),
      );
      await expect(system.run(system.engine.getProjectionCatchUpStatus)).resolves.toMatchObject({
        state: "healthy",
        missingProjectors: [],
      });
    } finally {
      await system.dispose();
    }
  });

  it("retries deferred projection catch-up while idle until it recovers", async () => {
    let bootstrapCalls = 0;
    let deferredCalls = 0;
    let resolveRecoveryBootstrap: (() => void) | null = null;
    const recoveryBootstrap = new Promise<void>((resolve) => {
      resolveRecoveryBootstrap = resolve;
    });
    const system = await createOrchestrationSystem({
      projectionPipeline: stubProjectionPipeline({
        bootstrap: Effect.suspend(() => {
          bootstrapCalls += 1;
          if (bootstrapCalls === 2 || bootstrapCalls === 3) {
            return Effect.fail(projectionFailure("test.deferredProjectionBootstrap"));
          }
          if (bootstrapCalls === 4) {
            resolveRecoveryBootstrap?.();
          }
          return Effect.void;
        }),
        projectDeferredEvent: () => {
          deferredCalls += 1;
          return deferredCalls === 1
            ? Effect.fail(projectionFailure("test.deferredProjection"))
            : Effect.void;
        },
      }),
    });
    const createdAt = now();
    try {
      await seedProjectAndThread(system, {
        projectId: "project-deferred-recovery",
        threadId: "thread-deferred-recovery",
        createdAt,
      });
      const result = await system.run(
        system.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-turn-start-deferred-recovery"),
          threadId: ThreadId.makeUnsafe("thread-deferred-recovery"),
          message: {
            messageId: MessageId.makeUnsafe("msg-deferred-recovery"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          runtimeMode: "approval-required",
          createdAt,
        }),
      );

      await recoveryBootstrap;

      expect(result.sequence).toBe(4);
      expect(deferredCalls).toBeGreaterThanOrEqual(1);
      expect(bootstrapCalls).toBe(4);
      await vi.waitFor(async () => {
        expect(await system.run(system.engine.getProjectionCatchUpStatus)).toMatchObject({
          state: "healthy",
          inFlight: false,
          retryAttempts: 0,
          lastFailure: null,
          missingProjectors: [],
        });
      });
    } finally {
      await system.dispose();
    }
  });

  it("restores the repair backup when rebuilt projectors do not reach the captured fence", async () => {
    const system = await createOrchestrationSystem({
      projectionPipeline: stubProjectionPipeline(),
    });
    try {
      await system.run(
        system.engine.dispatch(
          createProjectCommand({ projectId: "project-repair-fence", createdAt: now() }),
        ),
      );
      const beforeRepair = await system.run(system.engine.getReadModel());

      await expect(system.run(system.engine.repairState())).rejects.toThrow(
        "did not reach captured event fence 1",
      );
      await expect(system.run(system.engine.getReadModel())).resolves.toEqual(beforeRepair);
    } finally {
      await system.dispose();
    }
  });

  it("coalesces concurrent projection repairs and skips an immediate repeat", async () => {
    let bootstrapCalls = 0;
    let repairBootstrapCalls = 0;
    let resolveBootstrapStarted: (() => void) | undefined;
    let releaseBootstrap: (() => void) | undefined;
    const bootstrapStarted = new Promise<void>((resolve) => {
      resolveBootstrapStarted = resolve;
    });
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const system = await createOrchestrationSystem({
      projectionPipeline: stubProjectionPipeline({
        bootstrap: Effect.sync(() => (bootstrapCalls += 1)).pipe(
          Effect.flatMap((call) => {
            if (call === 1) {
              return Effect.void;
            }
            repairBootstrapCalls += 1;
            resolveBootstrapStarted?.();
            return Effect.promise(() => bootstrapGate);
          }),
        ),
      }),
    });
    try {
      const firstRepair = system.run(system.engine.repairState());
      await bootstrapStarted;
      const secondRepair = system.run(system.engine.repairState());
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseBootstrap?.();

      const [firstSnapshot, secondSnapshot] = await Promise.all([firstRepair, secondRepair]);
      expect(secondSnapshot).toEqual(firstSnapshot);
      expect(repairBootstrapCalls).toBe(1);

      await system.run(system.engine.repairState());
      expect(repairBootstrapCalls).toBe(1);
    } finally {
      await system.dispose();
    }
  });

  it("keeps the worker alive when a command throws while its pipeline is built", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const poisonedCommandId = "cmd-engine-poison";
    fingerprintPoison.add(poisonedCommandId);

    try {
      const poisonedOutcome = await system.run(
        Effect.result(
          system.engine.dispatch(
            createProjectCommand({
              commandId: poisonedCommandId,
              projectId: "project-engine-poison",
              createdAt,
            }),
          ),
        ).pipe(Effect.timeoutOption("5 seconds")),
      );

      expect(Option.isSome(poisonedOutcome)).toBe(true);
      const outcome = Option.getOrThrow(poisonedOutcome);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({ _tag: "OrchestrationCommandInternalError" });
      }

      await expect(
        system.run(
          system.engine.dispatch(
            createProjectCommand({ projectId: "project-engine-poison-next", createdAt }),
          ),
        ),
      ).resolves.toMatchObject({ sequence: expect.any(Number) });

      const drained = await system.run(
        Effect.timeoutOption(system.engine.drain, "5 seconds").pipe(Effect.map(Option.isSome)),
      );
      expect(drained).toBe(true);
    } finally {
      fingerprintPoison.delete(poisonedCommandId);
      await system.dispose();
    }
  });
});
