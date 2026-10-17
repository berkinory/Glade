import { CommandId, MessageId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { Clock, Duration, Effect } from "effect";

// Node timers pause while the host sleeps, so waits re-read the wall clock at least this often.
const WALL_CLOCK_CHECK_MS = 60_000;

export const sleepUntil = (targetMs: number) =>
  Effect.gen(function* () {
    for (;;) {
      const remainingMs = targetMs - (yield* Clock.currentTimeMillis);
      if (remainingMs <= 0) return;
      yield* Effect.sleep(Duration.millis(Math.min(remainingMs, WALL_CLOCK_CHECK_MS)));
    }
  });

// Child threads belong to the agent that delegated them, which owns their recovery.
export const isResumableThread = (thread: OrchestrationThread): boolean =>
  thread.deletedAt === null && thread.archivedAt == null && thread.parentThreadId === null;

// Counts the automatic resumes since the last human message. Messages are only those the engine saw
// since boot, so a restart starts a fresh chain.
export function consecutiveResumes(
  messages: OrchestrationThread["messages"],
  idPrefix: string,
): number {
  let resumes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    if (!message.id.startsWith(idPrefix)) break;
    resumes += 1;
  }
  return resumes;
}

export function resumeTurnCommand(input: {
  readonly idPrefix: string;
  readonly prompt: string;
  readonly thread: Pick<OrchestrationThread, "id" | "runtimeMode">;
  readonly turnId: TurnId;
  readonly scheduledAt: string;
  readonly now: string;
}): OrchestrationCommand {
  // Keyed by the stopped turn, so a duplicate wait for it can never send twice.
  const key = `${input.idPrefix}${input.turnId}`;
  return {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(key),
    threadId: input.thread.id,
    message: {
      messageId: MessageId.makeUnsafe(key),
      role: "user",
      text: input.prompt,
      attachments: [],
    },
    dispatchMode: "queue",
    dispatchOrigin: "agent",
    runtimeMode: input.thread.runtimeMode,
    resumePrecondition: { recordedTurnId: input.turnId, recordedAt: input.scheduledAt },
    createdAt: input.now,
  };
}
