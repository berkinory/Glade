import { TurnId } from "@glade/contracts/core/baseSchemas";
import {
  COMPUTER_ACCESS_QUESTION_ID,
  COMPUTER_ACCESS_REQUEST_PREFIX,
  COMPUTER_CLIPBOARD_ANSWERS,
} from "@glade/contracts/computer/computerUse";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { Deferred, Effect, Option } from "effect";
import { randomUUID } from "node:crypto";

export type ClipboardReadOutcome = "allowed" | "denied" | "pending";

export interface ClipboardReadRequest {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly waitMs: number;
}

interface ClipboardConsentDeps<E> {
  readonly appendActivity: (
    threadId: string,
    activity: Omit<OrchestrationThreadActivity, "id" | "createdAt" | "sequence">,
  ) => Effect.Effect<void, E>;
  readonly runtimeModeOf: (threadId: string) => Effect.Effect<RuntimeMode, E>;
}

export interface ClipboardConsent {
  readonly request: (request: ClipboardReadRequest) => Effect.Effect<ClipboardReadOutcome>;
  // Settles the thread's open clipboard card when `requestId` is one; false for other requests.
  readonly answer: (
    threadId: string,
    requestId: string,
    answers: Record<string, unknown>,
  ) => Effect.Effect<boolean>;
  readonly clearThread: (threadId: string) => void;
}

const answerOf = (answers: Record<string, unknown>) => {
  const raw = answers[COMPUTER_ACCESS_QUESTION_ID];
  const label = Array.isArray(raw) ? raw[0] : raw;
  return label === COMPUTER_CLIPBOARD_ANSWERS.allow
    ? "allowed"
    : label === COMPUTER_CLIPBOARD_ANSWERS.deny
      ? "denied"
      : null;
};

// Reading the clipboard can expose whatever the user copied (passwords, tokens), unlike every
// other Computer Use read, which is scoped to an app the thread was granted. Full-access threads
// read it without asking; other threads ask once with an access card, and the answer stands for
// the thread until the server restarts. Owned by ComputerAccess.
export function makeClipboardConsent<E>(deps: ClipboardConsentDeps<E>): ClipboardConsent {
  const answered = new Map<string, "allowed" | "denied">();
  const pending = new Map<
    string,
    { readonly requestId: string; readonly outcome: Deferred.Deferred<ClipboardReadOutcome> }
  >();

  const openCard = (request: ClipboardReadRequest) =>
    Effect.gen(function* () {
      const requestId = `${COMPUTER_ACCESS_REQUEST_PREFIX}clipboard:${randomUUID()}`;
      yield* deps.appendActivity(request.threadId, {
        tone: "approval",
        kind: "user-input.requested",
        summary: "Clipboard reading requested",
        turnId: request.turnId === null ? null : TurnId.makeUnsafe(request.turnId),
        payload: {
          requestId,
          questions: [
            {
              id: COMPUTER_ACCESS_QUESTION_ID,
              header: "Computer Use",
              question:
                "The agent asks to read the clipboard. It may hold anything you copied, including passwords.",
              options: [
                {
                  label: COMPUTER_CLIPBOARD_ANSWERS.allow,
                  description: "Let the agent read copied text for the rest of this chat.",
                },
                {
                  label: COMPUTER_CLIPBOARD_ANSWERS.deny,
                  description: "Refuse; the agent will not ask again in this chat.",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      });
      return requestId;
    });

  return {
    request: (request) =>
      Effect.gen(function* () {
        const known = answered.get(request.threadId);
        if (known) return known;
        if ((yield* deps.runtimeModeOf(request.threadId)) === "full-access") return "allowed";
        let open = pending.get(request.threadId);
        if (!open) {
          const requestId = yield* openCard(request);
          open = { requestId, outcome: yield* Deferred.make<ClipboardReadOutcome>() };
          pending.set(request.threadId, open);
        }
        const outcome = yield* Deferred.await(open.outcome).pipe(
          Effect.timeoutOption(request.waitMs),
        );
        return Option.getOrElse(outcome, (): ClipboardReadOutcome => "pending");
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("computer clipboard card failed", { error: String(error) }).pipe(
            Effect.as<ClipboardReadOutcome>("pending"),
          ),
        ),
      ),
    answer: (threadId, requestId, answers) =>
      Effect.gen(function* () {
        const open = pending.get(threadId);
        if (open?.requestId !== requestId) return false;
        pending.delete(threadId);
        const outcome = answerOf(answers);
        // An unreadable (typed) answer closes the card; the agent asks again if it still needs to.
        if (outcome) answered.set(threadId, outcome);
        yield* Deferred.succeed(open.outcome, outcome ?? "pending");
        return true;
      }),
    clearThread: (threadId) => {
      answered.delete(threadId);
      pending.delete(threadId);
    },
  };
}
