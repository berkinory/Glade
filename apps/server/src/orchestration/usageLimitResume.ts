import { CommandId, EventId, type ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import {
  USAGE_LIMIT_RESUME_CANCELLED_ACTIVITY_KIND,
  USAGE_LIMIT_RESUME_SCHEDULED_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/usageLimitResume";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import type { ServerProviderUsageSnapshot } from "@glade/contracts/server/server";
import { randomUUID } from "node:crypto";
import { consecutiveResumes, resumeTurnCommand } from "./agentResume.ts";

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

export function usageLimitResumeChainExhausted(messages: OrchestrationThread["messages"]): boolean {
  return consecutiveResumes(messages, RESUME_ID_PREFIX) >= MAX_CONSECUTIVE_RESUMES;
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
  return resumeTurnCommand({ ...input, idPrefix: RESUME_ID_PREFIX, prompt: CONTINUATION_PROMPT });
}
