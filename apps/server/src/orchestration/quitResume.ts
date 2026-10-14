import type { TaggedFailure } from "../platform/operationError.ts";

import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type {
  OrchestrationPrepareQuitResumeInput,
  OrchestrationPrepareQuitResumeResult,
} from "@glade/contracts/orchestration/rpc";
import type {
  OrchestrationProject,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import {
  CommandId,
  IsoDateTime,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  QUIT_RESUME_MAX_PROMPT_CHARS,
  QUIT_RESUME_MAX_THREADS,
} from "@glade/contracts/orchestration/rpc";
import { Duration, Effect, FileSystem, Schema } from "effect";
import { randomUUID } from "node:crypto";

import { writeFileStringAtomically } from "../platform/filesystem/atomicWrite";
import { ServerConfig } from "../server/config";
import {
  threadHasInFlightTurn,
  threadResumePreconditionViolation,
  type ThreadResumePreconditionViolation,
} from "./commandInvariants.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

// A quit normally stops this process within seconds (desktop shutdown timeout is 10s). A record
// still owned by a live process this long after it was written belongs to a quit that was cancelled
// and must not survive.
const QUIT_RESUME_ABANDON_AFTER_MS = 30_000;

const sleepUnref = (duration: Duration.Input) =>
  Effect.callback<void>((resume) => {
    const timer = setTimeout(
      () => resume(Effect.void),
      Duration.toMillis(Duration.fromInputUnsafe(duration)),
    );
    timer.unref();
    return Effect.sync(() => clearTimeout(timer));
  });

const QuitResumeRecord = Schema.Struct({
  version: Schema.Literal(1),
  // Unique per quit; command/message ids derive from it so replays dedup and quits never collide.
  recordId: TrimmedNonEmptyString,
  recordedAt: IsoDateTime,
  continuationPrompt: TrimmedNonEmptyString.check(Schema.isMaxLength(QUIT_RESUME_MAX_PROMPT_CHARS)),
  threads: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,

      turnId: Schema.NullOr(TurnId),
    }),
  ).check(Schema.isMaxLength(QUIT_RESUME_MAX_THREADS)),
});
type QuitResumeRecord = typeof QuitResumeRecord.Type;

const decodeQuitResumeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(QuitResumeRecord));

type ThreadTurnStartCommand = Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>;
type ThreadTurnInterruptCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.turn.interrupt" }
>;

export type QuitResumeRecordableThread = Pick<
  OrchestrationThread,
  "id" | "deletedAt" | "latestTurn" | "session"
>;

type ResumeThread = Pick<
  OrchestrationThread,
  | "id"
  | "title"
  | "projectId"
  | "deletedAt"
  | "archivedAt"
  | "latestTurn"
  | "session"
  | "runtimeMode"
>;
type ResumeProject = Pick<OrchestrationProject, "id" | "deletedAt">;

type ResumeSkipReason =
  | "thread-missing"
  | "thread-deleted"
  | "project-missing"
  | ThreadResumePreconditionViolation;

export interface ResumeTurnEntry {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly recordedAt: string;
  // Command and message ids derive from it, so a replayed or repeated resume is deduplicated.
  readonly key: string;
}

interface ResumePlan {
  readonly resumable: ReadonlyArray<{
    readonly entry: ResumeTurnEntry;
    readonly thread: ResumeThread;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly reason: ResumeSkipReason;
  }>;
}

function inFlightTurnId(thread: QuitResumeRecordableThread): TurnId | null {
  return (
    thread.session?.activeTurnId ??
    (thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null)
  );
}

function buildQuitResumeRecord(input: {
  readonly request: OrchestrationPrepareQuitResumeInput;
  readonly threads: ReadonlyArray<QuitResumeRecordableThread>;
  readonly recordId: string;
  readonly now: string;
}): QuitResumeRecord {
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const seen = new Set<ThreadId>();
  const threads: Array<QuitResumeRecord["threads"][number]> = [];
  for (const threadId of input.request.threadIds) {
    if (seen.has(threadId)) {
      continue;
    }
    seen.add(threadId);
    const thread = threadsById.get(threadId);
    if (!thread || thread.deletedAt !== null || !threadHasInFlightTurn(thread)) {
      continue;
    }
    threads.push({ threadId, turnId: inFlightTurnId(thread) });
  }
  return {
    version: 1,
    recordId: input.recordId,
    recordedAt: input.now,
    continuationPrompt: input.request.continuationPrompt,
    threads,
  };
}

function buildQuitInterruptCommand(input: {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly recordId: string;
  readonly recordedAt: string;
}): ThreadTurnInterruptCommand {
  return {
    type: "thread.turn.interrupt",
    commandId: CommandId.makeUnsafe(`quit-resume-interrupt:${input.recordId}:${input.threadId}`),
    threadId: input.threadId,
    ...(input.turnId !== null ? { turnId: input.turnId } : {}),
    createdAt: input.recordedAt,
  };
}

export function planResume(input: {
  readonly entries: ReadonlyArray<ResumeTurnEntry>;
  readonly threads: ReadonlyArray<ResumeThread>;
  readonly projects: ReadonlyArray<ResumeProject>;
}): ResumePlan {
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const liveProjectIds = new Set(
    input.projects.filter((project) => project.deletedAt === null).map((project) => project.id),
  );
  const resumable: Array<ResumePlan["resumable"][number]> = [];
  const skipped: Array<ResumePlan["skipped"][number]> = [];

  for (const entry of input.entries) {
    const thread = threadsById.get(entry.threadId);
    if (!thread) {
      skipped.push({ threadId: entry.threadId, reason: "thread-missing" });
      continue;
    }
    const reason =
      thread.deletedAt !== null
        ? "thread-deleted"
        : !liveProjectIds.has(thread.projectId)
          ? "project-missing"
          : threadResumePreconditionViolation(thread, resumePrecondition(entry));
    if (reason !== null) {
      skipped.push({ threadId: entry.threadId, reason });
      continue;
    }
    resumable.push({ entry, thread });
  }

  return { resumable, skipped };
}

const resumePrecondition = (entry: ResumeTurnEntry) => ({
  recordedTurnId: entry.turnId,
  recordedAt: entry.recordedAt,
});

export function buildResumeTurnCommand(input: {
  readonly entry: ResumeTurnEntry;
  readonly thread: ResumeThread;
  readonly continuationPrompt: string;
  readonly now: string;
}): ThreadTurnStartCommand {
  return {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(input.entry.key),
    threadId: input.entry.threadId,
    message: {
      messageId: MessageId.makeUnsafe(input.entry.key),
      role: "user",
      text: input.continuationPrompt,
      attachments: [],
    },
    dispatchMode: "queue",
    dispatchOrigin: "agent",
    runtimeMode: input.thread.runtimeMode,

    resumePrecondition: resumePrecondition(input.entry),
    createdAt: input.now,
  };
}

const persistQuitResumeRecord = (input: {
  readonly path: string;
  readonly record: QuitResumeRecord;
}) =>
  writeFileStringAtomically({
    filePath: input.path,
    contents: `${JSON.stringify(input.record)}\n`,
  });

const clearQuitResumeRecord = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path, { force: true });
  });

export type QuitResumeRecordRead =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "record"; readonly record: QuitResumeRecord };

const readQuitResumeRecord = (
  path: string,
): Effect.Effect<QuitResumeRecordRead, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return { kind: "absent" } as const;
    }
    const raw = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { kind: "invalid" } as const;
    }
    return yield* decodeQuitResumeRecord(trimmed).pipe(
      Effect.map((record) => ({ kind: "record", record }) as const),
      Effect.orElseSucceed(() => ({ kind: "invalid" }) as const),
    );
  });

const claimQuitResumeRecord = (
  path: string,
): Effect.Effect<QuitResumeRecordRead, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const claimedPath = `${path}.${process.pid}.${randomUUID()}.claimed`;
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return { kind: "absent" } as const;
    }
    const claimed = yield* fs.rename(path, claimedPath).pipe(
      Effect.as(true),
      Effect.catchCause((cause) =>
        Effect.logWarning("quit-resume record could not be claimed; skipping resume", {
          path,
          cause,
        }).pipe(Effect.as(false)),
      ),
    );
    if (!claimed) {
      return { kind: "absent" } as const;
    }
    const read = yield* readQuitResumeRecord(claimedPath);
    yield* clearQuitResumeRecord(claimedPath).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("claimed quit-resume record could not be removed", {
          path: claimedPath,
          cause,
        }),
      ),
    );
    return read;
  });

const clearQuitResumeRecordIfOwned = (path: string, recordId: string) =>
  Effect.gen(function* () {
    const current = yield* readQuitResumeRecord(path);
    if (current.kind !== "record" || current.record.recordId !== recordId) {
      return false;
    }
    yield* clearQuitResumeRecord(path);
    return true;
  });

export const prepareQuitResume = (input: {
  readonly request: OrchestrationPrepareQuitResumeInput;
  readonly recordPath: string;
  readonly getReadModel: () => Effect.Effect<
    { readonly threads: ReadonlyArray<QuitResumeRecordableThread> },
    never
  >;
  readonly dispatch: (command: OrchestrationCommand) => Effect.Effect<unknown, TaggedFailure>;
  readonly abandonAfter?: Duration.Input;
}): Effect.Effect<OrchestrationPrepareQuitResumeResult, TaggedFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const now = new Date().toISOString();
    const readModel = yield* input.getReadModel();
    const record = buildQuitResumeRecord({
      request: input.request,
      threads: readModel.threads,
      recordId: randomUUID(),
      now,
    });
    yield* persistQuitResumeRecord({ path: input.recordPath, record });
    yield* Effect.logInfo("recorded running chats for resume after quit", {
      recordId: record.recordId,
      threadIds: record.threads.map((entry) => entry.threadId),
    });

    yield* sleepUnref(input.abandonAfter ?? Duration.millis(QUIT_RESUME_ABANDON_AFTER_MS)).pipe(
      Effect.andThen(clearQuitResumeRecordIfOwned(input.recordPath, record.recordId)),
      Effect.flatMap((cleared) =>
        cleared
          ? Effect.logWarning("quit did not complete; dropped the quit-resume record", {
              recordId: record.recordId,
            })
          : Effect.void,
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("quit-resume abandon sweep failed", { recordId: record.recordId, cause }),
      ),

      Effect.forkDetach,
    );

    // The durable write is the RPC acknowledgement contract. Interrupts are best-effort and must not
    // make the renderer miss its bounded quit wait; process shutdown itself will stop any provider
    // command that remains live.
    yield* Effect.forEach(
      record.threads,
      (entry) =>
        input
          .dispatch(
            buildQuitInterruptCommand({
              threadId: entry.threadId,
              turnId: entry.turnId,
              recordId: record.recordId,
              recordedAt: record.recordedAt,
            }),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to interrupt chat for quit", {
                threadId: entry.threadId,
                cause,
              }),
            ),
          ),
      { discard: true, concurrency: "unbounded" },
    ).pipe(Effect.forkDetach);

    return {
      recordedThreadIds: record.threads.map((entry) => entry.threadId),
      recordedAt: record.recordedAt,
    };
  });

export const claimQuitResumeRecordAtStartup: Effect.Effect<
  QuitResumeRecordRead,
  never,
  ServerConfig | FileSystem.FileSystem
> = Effect.gen(function* () {
  const config = yield* ServerConfig;
  // Claim before dispatching: a second process or a crash mid-dispatch must never resume the same
  // chats twice. An unreadable record is consumed too, so it does not get re-parsed (and silently
  // ignored) on every later boot.
  const claimed = yield* claimQuitResumeRecord(config.quitResumeStatePath);
  if (claimed.kind === "invalid") {
    yield* Effect.logWarning("dropped an unreadable quit-resume record", {
      path: config.quitResumeStatePath,
    });
  }
  return claimed;
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("claiming the quit-resume record failed", { cause }).pipe(
      Effect.as({ kind: "absent" } as const),
    ),
  ),
);

// Every failure is contained and logged — resuming must never affect server startup.
export const resumeQuitInterruptedChats = (
  claimed: QuitResumeRecordRead,
): Effect.Effect<void, never, OrchestrationEngineService> =>
  Effect.gen(function* () {
    if (claimed.kind !== "record") {
      return;
    }
    const record = claimed.record;
    const engine = yield* OrchestrationEngineService;

    const readModel = yield* engine.getReadModel();
    const plan = planResume({
      entries: record.threads.map((entry) => ({
        threadId: entry.threadId,
        turnId: entry.turnId,
        recordedAt: record.recordedAt,
        key: `quit-resume:${record.recordId}:${entry.threadId}`,
      })),
      threads: readModel.threads,
      projects: readModel.projects,
    });
    const now = new Date().toISOString();
    const commands = plan.resumable.map((resumable) =>
      buildResumeTurnCommand({ ...resumable, continuationPrompt: record.continuationPrompt, now }),
    );

    if (plan.skipped.length > 0) {
      yield* Effect.logInfo("skipping quit-resume for threads that moved on", {
        recordId: record.recordId,
        skipped: plan.skipped,
      });
    }
    if (commands.length === 0) {
      return;
    }

    yield* Effect.logInfo("resuming chats interrupted by the previous quit", {
      recordId: record.recordId,
      recordedAt: record.recordedAt,
      threadIds: commands.map((command) => command.threadId),
    });

    yield* Effect.forEach(
      commands,
      (command) =>
        engine.dispatch(command).pipe(
          Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
            Effect.logInfo("quit-resume turn was not accepted", {
              threadId: command.threadId,
              detail: error.detail,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("quit-resume turn failed to dispatch", {
              threadId: command.threadId,
              cause,
            }),
          ),
        ),
      { discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("resuming chats after quit failed", { cause })),
  );
