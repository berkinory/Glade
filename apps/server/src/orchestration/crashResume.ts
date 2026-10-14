import type {
  OrchestrationCrashResumeOffer,
  OrchestrationResolveCrashResumeInput,
  OrchestrationResolveCrashResumeResult,
} from "@glade/contracts/orchestration/rpc";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type {
  OrchestrationMessage,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import { IsoDateTime, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { QUIT_RESUME_MAX_THREADS } from "@glade/contracts/orchestration/rpc";
import { Effect, FileSystem, Option, Schema } from "effect";

import { ProjectionPendingInteractionRepository } from "../persistence/Services/ProjectionPendingInteractions.ts";
import { writeFileStringAtomically } from "../platform/filesystem/atomicWrite";
import { ServerConfig } from "../server/config";
import { buildResumeTurnCommand, planResume } from "./quitResume.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const CrashResumeChat = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  recordedAt: IsoDateTime,
});
type CrashResumeChat = typeof CrashResumeChat.Type;

const CrashResumeRecord = Schema.Struct({
  version: Schema.Literal(1),
  chats: Schema.Array(CrashResumeChat).check(Schema.isMaxLength(QUIT_RESUME_MAX_THREADS)),
});
type CrashResumeRecord = typeof CrashResumeRecord.Type;

const decodeCrashResumeRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CrashResumeRecord),
);

// The agent gateway ids every message it sends into another chat this way; such turns belong to
// the delegating agent, which owns their recovery.
const DELEGATED_MESSAGE_ID_PREFIX = "agent:";

interface CrashResumeCandidate extends Pick<
  OrchestrationThread,
  | "id"
  | "deletedAt"
  | "archivedAt"
  | "parentThreadId"
  | "creationSource"
  | "latestTurn"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
> {
  readonly messages: ReadonlyArray<
    Pick<OrchestrationMessage, "id" | "role" | "turnId" | "dispatchOrigin">
  >;
}

// Only ordinary top-level chats whose turn was working on its own are offered. A chat waiting on a
// person, a subagent, and work started by an agent or an automation keep their own recovery paths.
function crashInterruptedTurnId(
  thread: CrashResumeCandidate,
  blockedThreadIds: ReadonlySet<ThreadId>,
): TurnId | null {
  const turn = thread.latestTurn;
  if (
    turn?.state !== "running" ||
    thread.deletedAt !== null ||
    thread.archivedAt != null ||
    thread.parentThreadId != null ||
    thread.creationSource != null ||
    thread.hasPendingApprovals === true ||
    thread.hasPendingUserInput === true ||
    blockedThreadIds.has(thread.id)
  ) {
    return null;
  }
  const message = thread.messages.findLast(
    (candidate) => candidate.role === "user" && candidate.turnId === turn.turnId,
  );
  if (
    message === undefined ||
    message.dispatchOrigin === "automation" ||
    (message.dispatchOrigin === "agent" && message.id.startsWith(DELEGATED_MESSAGE_ID_PREFIX))
  ) {
    return null;
  }
  return turn.turnId;
}

function selectCrashResumeChats(input: {
  readonly threads: ReadonlyArray<CrashResumeCandidate>;
  readonly blockedThreadIds: ReadonlySet<ThreadId>;
  readonly now: string;
}): ReadonlyArray<CrashResumeChat> {
  return input.threads.flatMap((thread) => {
    const turnId = crashInterruptedTurnId(thread, input.blockedThreadIds);
    return turnId === null ? [] : [{ threadId: thread.id, turnId, recordedAt: input.now }];
  });
}

// An offer nobody answered survives the next crash; a chat captured again keeps only its newest turn.
function mergeCrashResumeChats(
  existing: ReadonlyArray<CrashResumeChat>,
  captured: ReadonlyArray<CrashResumeChat>,
): ReadonlyArray<CrashResumeChat> {
  const capturedIds = new Set(captured.map((chat) => chat.threadId));
  return [...captured, ...existing.filter((chat) => !capturedIds.has(chat.threadId))].slice(
    0,
    QUIT_RESUME_MAX_THREADS,
  );
}

// A chat stays offered only while the interrupted turn is still its latest and nothing has
// continued it since; the start command re-checks the same precondition when it is dispatched.
function resumableCrashChats(
  record: CrashResumeRecord,
  readModel: Pick<OrchestrationReadModel, "threads" | "projects">,
) {
  const latestTurnIdByThread = new Map(
    readModel.threads.map((thread) => [thread.id, thread.latestTurn?.turnId ?? null]),
  );
  return planResume({
    entries: record.chats
      .filter((chat) => latestTurnIdByThread.get(chat.threadId) === chat.turnId)
      .map((chat) => ({
        threadId: chat.threadId,
        turnId: chat.turnId,
        recordedAt: chat.recordedAt,
        key: `crash-resume:${chat.turnId}:${chat.threadId}`,
      })),
    threads: readModel.threads,
    projects: readModel.projects,
  }).resumable;
}

const readCrashResumeRecord = (
  path: string,
): Effect.Effect<CrashResumeRecord | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return null;
    }
    const raw = yield* fs.readFileString(path);
    return yield* decodeCrashResumeRecord(raw.trim());
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("ignoring an unreadable crash-resume record", { path, cause }).pipe(
        Effect.as(null),
      ),
    ),
  );

// Runs after journal replay and before restart reconciliation settles the orphaned turns as
// interrupted. Every failure is logged and leaves startup untouched: the offer is a convenience.
export const captureCrashInterruptedChats: Effect.Effect<
  void,
  never,
  | ServerConfig
  | FileSystem.FileSystem
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | ProjectionPendingInteractionRepository
> = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const pendingInteractions = yield* ProjectionPendingInteractionRepository;

  const readModel = yield* engine.getReadModel();
  const running = readModel.threads.filter((thread) => thread.latestTurn?.state === "running");
  if (running.length === 0) {
    return;
  }
  // A failed read of open approvals or questions fails the capture rather than offering a chat
  // that is waiting on a person.
  const unsettled = yield* pendingInteractions.listUnsettled({});
  // The engine's command model carries no messages; the stored detail tells who started the turn.
  const details = yield* Effect.forEach(
    running,
    (thread) => snapshotQuery.getThreadDetailById(thread.id),
    { concurrency: 4 },
  );
  const captured = selectCrashResumeChats({
    threads: details.flatMap(Option.toArray),
    blockedThreadIds: new Set(unsettled.map((row) => row.threadId)),
    now: new Date().toISOString(),
  });
  if (captured.length === 0) {
    return;
  }
  const existing = yield* readCrashResumeRecord(config.crashResumeStatePath);
  const record: CrashResumeRecord = {
    version: 1,
    chats: mergeCrashResumeChats(existing?.chats ?? [], captured),
  };
  yield* writeFileStringAtomically({
    filePath: config.crashResumeStatePath,
    contents: `${JSON.stringify(record)}\n`,
  });
  yield* Effect.logInfo("recorded chats interrupted by an unexpected shutdown", {
    threadIds: captured.map((chat) => chat.threadId),
  });
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("could not record chats interrupted by an unexpected shutdown", { cause }),
  ),
);

export const getCrashResumeOffer: Effect.Effect<
  OrchestrationCrashResumeOffer,
  never,
  ServerConfig | FileSystem.FileSystem | OrchestrationEngineService
> = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const engine = yield* OrchestrationEngineService;
  const record = yield* readCrashResumeRecord(config.crashResumeStatePath);
  if (record === null) {
    return { chats: [] };
  }
  return {
    chats: resumableCrashChats(record, yield* engine.getReadModel()).map(({ thread }) => ({
      threadId: thread.id,
      title: thread.title,
    })),
  };
});

// Settles the offer once: the chosen chats get a continuation turn and the record is cleared. A
// failed dispatch keeps the record so the person can retry; command ids derive from the
// interrupted turn, so a retry or a second client never starts a chat twice.
export const resolveCrashResume = (input: OrchestrationResolveCrashResumeInput) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const engine = yield* OrchestrationEngineService;
    const fs = yield* FileSystem.FileSystem;
    const record = yield* readCrashResumeRecord(config.crashResumeStatePath);
    const continuedThreadIds: ThreadId[] = [];
    if (record !== null) {
      const chosen = new Set(input.continueThreadIds);
      const now = new Date().toISOString();
      const resumable = resumableCrashChats(record, yield* engine.getReadModel()).filter(
        ({ entry }) => chosen.has(entry.threadId),
      );
      for (const chat of resumable) {
        const command = buildResumeTurnCommand({
          ...chat,
          continuationPrompt: input.continuationPrompt,
          now,
        });
        const accepted = yield* engine.dispatch(command).pipe(
          Effect.as(true),
          Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
            Effect.logInfo("crash-resume turn was not accepted", {
              threadId: command.threadId,
              detail: error.detail,
            }).pipe(Effect.as(false)),
          ),
        );
        if (accepted) {
          continuedThreadIds.push(command.threadId);
        }
      }
    }
    yield* fs.remove(config.crashResumeStatePath, { force: true });
    return { continuedThreadIds } satisfies OrchestrationResolveCrashResumeResult;
  });
