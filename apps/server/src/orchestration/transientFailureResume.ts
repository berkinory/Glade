import { CommandId, EventId, type ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderFailure } from "@glade/contracts/provider/providerFailure";
import { randomUUID } from "node:crypto";
import { consecutiveResumes, resumeTurnCommand } from "./agentResume.ts";

const RESUME_ID_PREFIX = "transient-failure-resume:";
// Providers report these failures only after their own request retries ran out, so each resume
// waits longer. Together they ride out an outage of about half an hour before the user decides.
const RESUME_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000] as const;

const CONTINUATION_PROMPT =
  "The previous turn stopped on a temporary connection or provider error. Resume the unfinished task under its latest scope and constraints. Check the outcome of the last action before repeating it; the error may have cut it short.";

const TRANSIENT_FAILURE_RESUME_ACTIVITY_KIND = "transient-failure.resume-scheduled";

// A network drop or an overloaded or failing API that the provider stopped retrying. Usage limits
// have their own resume, and every other failure needs the user.
export function isTransientFailure(failure: ProviderFailure | undefined): boolean {
  return (
    failure !== undefined &&
    failure.retry.state === "none" &&
    (failure.kind === "connection_lost" ||
      failure.kind === "overloaded" ||
      (failure.kind === "internal" && failure.action === "retry"))
  );
}

interface TransientFailureResumeAttempt {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
}

// The next resume after the automatic resumes since the last human message; null once they ran out.
export function nextTransientFailureResume(
  messages: OrchestrationThread["messages"],
): TransientFailureResumeAttempt | null {
  const previous = consecutiveResumes(messages, RESUME_ID_PREFIX);
  const delayMs = RESUME_DELAYS_MS[previous];
  return delayMs === undefined
    ? null
    : { attempt: previous + 1, maxAttempts: RESUME_DELAYS_MS.length, delayMs };
}

export function transientFailureResumeActivityCommand(input: {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly resume: TransientFailureResumeAttempt;
  readonly now: string;
}): OrchestrationCommand {
  const { attempt, maxAttempts, delayMs } = input.resume;
  return {
    type: "thread.activity.append",
    commandId: CommandId.makeUnsafe(`server:${RESUME_ID_PREFIX}${randomUUID()}`),
    threadId: input.threadId,
    activity: {
      id: EventId.makeUnsafe(randomUUID()),
      tone: "info",
      kind: TRANSIENT_FAILURE_RESUME_ACTIVITY_KIND,
      summary: `Continuing in ${formatDelay(delayMs)} (attempt ${attempt} of ${maxAttempts})`,
      payload: { attempt, maxAttempts, delayMs },
      turnId: input.turnId,
      createdAt: input.now,
    },
    createdAt: input.now,
  };
}

function formatDelay(delayMs: number): string {
  const seconds = Math.round(delayMs / 1000);
  return seconds < 60 ? `${seconds} seconds` : `${Math.round(seconds / 60)} min`;
}

export function transientFailureResumeTurnCommand(input: {
  readonly thread: Pick<OrchestrationThread, "id" | "runtimeMode">;
  readonly turnId: TurnId;
  readonly scheduledAt: string;
  readonly now: string;
}): OrchestrationCommand {
  return resumeTurnCommand({ ...input, idPrefix: RESUME_ID_PREFIX, prompt: CONTINUATION_PROMPT });
}
