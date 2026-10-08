import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationThreadShell } from "@glade/contracts/orchestration/threadEntities";
import type { ServerKeepAwakeStatus } from "@glade/contracts/server/keepAwake";
import { isExecutableFile } from "@glade/shared/platform/executable";
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  Ref,
  Stream,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/unstable/process";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { shouldPublishThreadShellForEvent } from "../../orchestration/threadShellEvents";
import { makeEffectProcessCommand } from "../../platform/effectProcessRuntime";
import { ServerSettingsService } from "../../settings/serverSettings";
import { KeepAwake, type KeepAwakeShape } from "../Services/KeepAwake";

// An absolute path keeps a PATH entry from shadowing the system binary.
const CAFFEINATE_PATH = "/usr/bin/caffeinate";
const MAX_CONSECUTIVE_FAILURES = 5;
const STABLE_RUN_MS = 60_000;

// Work counts while a session is starting or running a turn, or while the latest turn still owns
// backgrounded tasks. A turn that only waits for an approval or an answer does no work, so it does
// not hold the Mac awake on its own.
function isThreadWorking(shell: OrchestrationThreadShell): boolean {
  if ((shell.backgroundWork?.taskIds.length ?? 0) > 0) return true;
  const status = shell.session?.status;
  if (status !== "running" && status !== "starting") return false;
  return shell.hasPendingApprovals !== true && shell.hasPendingUserInput !== true;
}

function describeExit(exit: Exit.Exit<unknown, unknown>): string {
  if (Exit.isSuccess(exit)) return `exited with code ${String(exit.value)}`;
  const error = Cause.squash(exit.cause);
  // Spawner errors wrap the signal or errno that actually explains the exit.
  const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return reason instanceof Error ? reason.message : String(reason);
}

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const supported = process.platform === "darwin" && isExecutableFile(CAFFEINATE_PATH);
  const statusRef = yield* Ref.make<ServerKeepAwakeStatus>({
    supported,
    active: false,
    error: null,
  });
  const workingThreadsRef = yield* Ref.make<ReadonlySet<string>>(new Set());
  const wantedRef = yield* Ref.make(false);
  const reconcileLock = yield* Semaphore.make(1);

  const setActive = (active: boolean) =>
    Ref.update(statusRef, (status) => ({ ...status, active, ...(active ? { error: null } : {}) }));

  // `-i` prevents idle system sleep only; the display may still sleep. `-w` ties the assertion to
  // this server process, so the kernel releases it even when the server dies without cleanup.
  const runCaffeinate = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        makeEffectProcessCommand(CAFFEINATE_PATH, ["-i", "-w", String(process.pid)], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      yield* setActive(true);
      return yield* child.exitCode;
    }),
  );

  const holdAssertion = Effect.gen(function* () {
    let failures = 0;
    while (true) {
      const startedAt = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(runCaffeinate);
      yield* setActive(false);
      const ranMs = (yield* Clock.currentTimeMillis) - startedAt;
      failures = ranMs >= STABLE_RUN_MS ? 1 : failures + 1;
      const detail = describeExit(exit);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        yield* Effect.logWarning("keep-awake assertion stopped after repeated failures", {
          detail,
        });
        yield* Ref.update(statusRef, (status) => ({
          ...status,
          error: `caffeinate failed ${failures} times in a row: ${detail}`,
        }));
        return;
      }
      yield* Effect.logWarning("keep-awake assertion ended unexpectedly; restarting", {
        detail,
        failures,
      });
      yield* Effect.sleep(Duration.seconds(2 ** (failures - 1)));
    }
  });

  const reconcile = (holder: FiberHandle.FiberHandle) =>
    reconcileLock.withPermits(1)(
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.catch((error) =>
            Effect.logWarning("keep-awake could not read settings", {
              detail: error.detail,
            }).pipe(Effect.as(null)),
          ),
        );
        if (settings === null) return;
        const mode = settings.keepAwakeMode;
        const workingCount = (yield* Ref.get(workingThreadsRef)).size;
        const wanted = supported && (mode === "always" || (mode === "agent" && workingCount > 0));
        if (wanted === (yield* Ref.get(wantedRef))) return;
        yield* Ref.set(wantedRef, wanted);
        if (wanted) {
          yield* FiberHandle.run(holder, holdAssertion);
          return;
        }
        yield* FiberHandle.clear(holder);
        yield* Ref.update(statusRef, (status) => ({ ...status, active: false, error: null }));
      }),
    );

  const setThreadWorking = (threadId: string, working: boolean) =>
    Ref.modify(workingThreadsRef, (current): [boolean, ReadonlySet<string>] => {
      if (current.has(threadId) === working) return [false, current];
      const next = new Set(current);
      if (working) next.add(threadId);
      else next.delete(threadId);
      return [true, next];
    });

  const refreshThread = (event: OrchestrationEvent) => {
    if (event.type === "thread.deleted") {
      return setThreadWorking(event.payload.threadId, false);
    }
    const threadId = ThreadId.makeUnsafe(String(event.aggregateId));
    return projectionSnapshotQuery.getThreadShellById(threadId).pipe(
      Effect.flatMap((shell) =>
        setThreadWorking(threadId, Option.isSome(shell) && isThreadWorking(shell.value)),
      ),
      Effect.catch((error) =>
        Effect.logWarning("keep-awake could not read thread activity", {
          threadId,
          detail: String(error),
        }).pipe(Effect.as(false)),
      ),
    );
  };

  const start: KeepAwakeShape["start"] = Effect.fn(function* () {
    if (!supported) return;
    const holder = yield* FiberHandle.make();
    yield* Effect.addFinalizer(() =>
      FiberHandle.clear(holder).pipe(Effect.andThen(setActive(false))),
    );

    // Subscribe to both sources before reading current state so no transition falls between them.
    const domainEvents = yield* orchestrationEngine.subscribeDomainEvents;
    yield* Effect.forkScoped(
      Stream.runForEach(serverSettings.streamChanges, () => reconcile(holder)),
      { startImmediately: true },
    );
    const working = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
      Effect.map(
        (snapshot) =>
          new Set(snapshot.threads.filter(isThreadWorking).map((thread) => thread.id as string)),
      ),
      Effect.catch((error) =>
        Effect.logWarning("keep-awake could not read running work; starting empty", {
          detail: String(error),
        }).pipe(Effect.as(new Set<string>())),
      ),
    );
    yield* Ref.set(workingThreadsRef, working);
    yield* reconcile(holder);

    yield* Effect.forkScoped(
      Stream.runForEach(domainEvents, (event) => {
        if (
          event.type !== "thread.deleted" &&
          (event.aggregateKind !== "thread" || !shouldPublishThreadShellForEvent(event))
        ) {
          return Effect.void;
        }
        return refreshThread(event).pipe(
          Effect.flatMap((changed) => (changed ? reconcile(holder) : Effect.void)),
        );
      }),
    );
  });

  return {
    start,
    getStatus: Ref.get(statusRef),
  } satisfies KeepAwakeShape;
});

export const KeepAwakeLive = Layer.effect(KeepAwake, make);
