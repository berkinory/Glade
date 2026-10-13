import {
  CommandId,
  EventId,
  MessageId,
  type ThreadId,
  type TurnId,
} from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import {
  USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/usageLimitResume";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import type { ServerProviderUsageSnapshot } from "@glade/contracts/server/server";
import { randomUUID } from "node:crypto";

const RESUME_ID_PREFIX = "usage-limit-resume:";
// Each automatic resume that runs into the limit again arms the next one; a chain this long without
// a human message stops, so a misreported reset cannot spend every window unattended.
const MAX_CONSECUTIVE_RESUMES = 2;
// Weekly limits can reset days out; resuming that late is a decision for the user.
export const USAGE_LIMIT_RESUME_MAX_WAIT_MS = 24 * 60 * 60_000;

const CONTINUATION_PROMPT =
  "The usage limit that stopped this chat has reset. Resume the unfinished task under its latest scope and constraints. Check the outcome of the last action before repeating it; the limit may have cut it short.";

export function isUsageLimitFailure(failure: ProviderFailure | undefined): boolean {
  return (
    failure !== undefined &&
    failure.retry.state === "none" &&
    (failure.kind === "quota_exhausted" || failure.kind === "rate_limited")
  );
}

// Messages are only those the engine saw since boot, so a restart starts a fresh chain.
export function usageLimitResumeChainExhausted(messages: OrchestrationThread["messages"]): boolean {
  let resumes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    if (!message.id.startsWith(RESUME_ID_PREFIX)) break;
    resumes += 1;
  }
  return resumes >= MAX_CONSECUTIVE_RESUMES;
}

// The latest reset among windows the provider reports as used up; null when none is.
export function exhaustedUsageResetsAt(
  snapshots: ReadonlyArray<ServerProviderUsageSnapshot>,
  nowMs: number,
): string | null {
  let latest: { readonly iso: string; readonly ms: number } | null = null;
  for (const limit of snapshots.flatMap((snapshot) => snapshot.limits)) {
    if (limit.usedPercent === undefined || limit.usedPercent < 100 || !limit.resetsAt) continue;
    const ms = Date.parse(limit.resetsAt);
    if (Number.isNaN(ms) || ms <= nowMs || (latest && latest.ms >= ms)) continue;
    latest = { iso: limit.resetsAt, ms };
  }
  return latest?.iso ?? null;
}

export function usageLimitResumeActivityCommand(input: {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly resetsAt: string | null;
  readonly now: string;
}): OrchestrationCommand {
  const scheduled = input.resetsAt !== null;
  return {
    type: "thread.activity.append",
    commandId: CommandId.makeUnsafe(`server:${RESUME_ID_PREFIX}${randomUUID()}`),
    threadId: input.threadId,
    activity: {
      id: EventId.makeUnsafe(randomUUID()),
      tone: "info",
      kind: scheduled
        ? USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND
        : USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
      summary: scheduled
        ? "Continuing when the usage limit resets"
        : "Automatic continue cancelled",
      payload: scheduled ? { resetsAt: input.resetsAt } : {},
      turnId: input.turnId,
      createdAt: input.now,
    },
    createdAt: input.now,
  };
}

export function usageLimitResumeTurnCommand(input: {
  readonly thread: Pick<OrchestrationThread, "id" | "runtimeMode">;
  readonly turnId: TurnId;
  readonly scheduledAt: string;
  readonly now: string;
}): OrchestrationCommand {
  // Keyed by the stopped turn, so a duplicate wait for it can never send twice.
  const key = `${RESUME_ID_PREFIX}${input.turnId}`;
  return {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(key),
    threadId: input.thread.id,
    message: {
      messageId: MessageId.makeUnsafe(key),
      role: "user",
      text: CONTINUATION_PROMPT,
      attachments: [],
    },
    dispatchMode: "queue",
    dispatchOrigin: "agent",
    runtimeMode: input.thread.runtimeMode,
    resumePrecondition: { recordedTurnId: input.turnId, recordedAt: input.scheduledAt },
    createdAt: input.now,
  };
}
