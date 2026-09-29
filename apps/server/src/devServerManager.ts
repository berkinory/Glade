import {
  DEFAULT_TERMINAL_ID,
  ProjectId,
  type ProjectDevServer,
  type ProjectDevServerEvent,
  type ProjectListDevServersResult,
  type ProjectRunDevServerInput,
  type ProjectRunDevServerResult,
  type ProjectStopDevServerInput,
  type ProjectStopDevServerResult,
  type ServerLocalServerProcess,
} from "@glade/contracts";
import { localServerMatchesRun } from "@glade/shared/localServers";
import { Effect, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";

import { TerminalManager, type TerminalError } from "./terminal/Services/Manager";

// Dev servers reuse the terminal infrastructure under a reserved synthetic thread namespace so
// their PTYs never collide with real chat-thread terminals.
const DEV_SERVER_THREAD_PREFIX = "dev-server:";
const DEV_SERVER_TERMINAL_COLS = 120;
const DEV_SERVER_TERMINAL_ROWS = 30;

const devServerThreadId = (projectId: ProjectId): string =>
  `${DEV_SERVER_THREAD_PREFIX}${projectId}`;

const parseDevServerProjectId = (threadId: string): ProjectId | null => {
  if (!threadId.startsWith(DEV_SERVER_THREAD_PREFIX)) {
    return null;
  }
  const raw = threadId.slice(DEV_SERVER_THREAD_PREFIX.length);
  return raw.length > 0 ? ProjectId.makeUnsafe(raw) : null;
};

export function findProjectDevServerForLocalServer(input: {
  localServer: ServerLocalServerProcess;
  devServers: readonly ProjectDevServer[];
}): ProjectDevServer | null {
  for (const devServer of input.devServers) {
    if (localServerMatchesRun(input.localServer, devServer)) {
      return devServer;
    }
  }
  return null;
}

export interface DevServerManagerShape {
  readonly run: (
    input: ProjectRunDevServerInput,
  ) => Effect.Effect<ProjectRunDevServerResult, TerminalError>;

  readonly stop: (input: ProjectStopDevServerInput) => Effect.Effect<ProjectStopDevServerResult>;

  readonly list: Effect.Effect<ProjectListDevServersResult>;

  readonly stream: Stream.Stream<ProjectDevServerEvent>;
}

export class DevServerManager extends ServiceMap.Service<DevServerManager, DevServerManagerShape>()(
  "glade/devServerManager",
) {}

export const DevServerManagerLive = Layer.effect(
  DevServerManager,
  Effect.gen(function* () {
    const terminalManager = yield* TerminalManager;
    const pubsub = yield* Effect.acquireRelease(
      PubSub.unbounded<ProjectDevServerEvent>(),
      PubSub.shutdown,
    );
    const registry = yield* Ref.make<Record<ProjectId, ProjectDevServer>>({});

    const publish = (event: ProjectDevServerEvent) => PubSub.publish(pubsub, event);

    // Reap a tracked dev server whose PTY exited or errored. Guarded so that a deliberate stop (which
    // removes the entry first) cannot double-publish, and so a stale exit for an already-replaced
    // project is ignored.
    const reapExited = (projectId: ProjectId) =>
      Ref.modify(registry, (current) => {
        if (!current[projectId]) {
          return [false, current] as const;
        }
        const next = { ...current };
        delete next[projectId];
        return [true, next] as const;
      }).pipe(
        Effect.flatMap((removed) =>
          removed ? publish({ type: "removed", projectId, reason: "exited" }) : Effect.void,
        ),
      );

    const unsubscribe = yield* terminalManager.subscribe((event) => {
      if (event.type !== "exited" && event.type !== "error") {
        return;
      }
      const projectId = parseDevServerProjectId(event.threadId);
      if (!projectId) {
        return;
      }
      Effect.runFork(reapExited(projectId));
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    const run: DevServerManagerShape["run"] = (input) =>
      Effect.gen(function* () {
        const threadId = devServerThreadId(input.projectId);

        const existing = (yield* Ref.get(registry))[input.projectId];
        if (existing) {
          yield* terminalManager
            .close({ threadId, deleteHistory: true })
            .pipe(Effect.catch(() => Effect.void));
        }

        const snapshot = yield* terminalManager.open({
          threadId,
          terminalId: DEFAULT_TERMINAL_ID,
          cwd: input.cwd,
          cols: DEV_SERVER_TERMINAL_COLS,
          rows: DEV_SERVER_TERMINAL_ROWS,

          streamOutput: false,
          ...(input.env ? { env: input.env } : {}),
        });

        yield* terminalManager.write({
          threadId,
          terminalId: DEFAULT_TERMINAL_ID,
          data: `${input.command}\r`,
        });

        const server: ProjectDevServer = {
          projectId: input.projectId,
          command: input.command,
          cwd: input.cwd,
          pid: snapshot.pid,
          startedAt: new Date().toISOString(),
          status: "running",
        };
        yield* Ref.update(registry, (current) => ({ ...current, [input.projectId]: server }));
        yield* publish({ type: "upserted", server });
        return { server };
      });

    const stop: DevServerManagerShape["stop"] = (input) =>
      Effect.gen(function* () {
        const removed = yield* Ref.modify(registry, (current) => {
          if (!current[input.projectId]) {
            return [false, current] as const;
          }
          const next = { ...current };
          delete next[input.projectId];
          return [true, next] as const;
        });
        if (!removed) {
          return { stopped: false };
        }
        yield* publish({ type: "removed", projectId: input.projectId, reason: "stopped" });
        yield* terminalManager
          .close({ threadId: devServerThreadId(input.projectId), deleteHistory: true })
          .pipe(Effect.catch(() => Effect.void));
        return { stopped: true };
      });

    const list: DevServerManagerShape["list"] = Ref.get(registry).pipe(
      Effect.map((current) => ({ servers: Object.values(current) })),
    );

    return {
      run,
      stop,
      list,
      get stream() {
        return Stream.fromPubSub(pubsub);
      },
    } satisfies DevServerManagerShape;
  }),
);
