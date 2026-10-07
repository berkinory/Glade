import { TurnId } from "@glade/contracts/core/baseSchemas";
import {
  COMPUTER_ACCESS_QUESTION_ID,
  COMPUTER_ACCESS_REQUEST_PREFIX,
  COMPUTER_CLIPBOARD_ANSWERS,
} from "@glade/contracts/computer/computerUse";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { Deferred, Effect, Option } from "effect";
import { createHash, randomUUID } from "node:crypto";

type ClipboardReadOutcome = "allowed" | "denied" | "pending";

interface ClipboardReadRequest {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly waitMs: number;
}

interface ClipboardConsentDeps<E> {
  readonly appendActivity: (
    threadId: string,
    activity: Omit<OrchestrationThreadActivity, "id" | "createdAt" | "sequence">,
  ) => Effect.Effect<void, E>;
}

export interface ClipboardPolicy {
  // Remembers what the thread's agent last put on the clipboard; null when it was not text.
  readonly recordWrite: (threadId: string, text: string | null) => void;
  // True when the thread may read `text` (the clipboard's current text) without a card.
  readonly mayRead: (threadId: string, text: string | null) => boolean;
  // Asks with the thread's clipboard card, or returns the thread's earlier answer.
  readonly request: (request: ClipboardReadRequest) => Effect.Effect<ClipboardReadOutcome>;
}

export interface ClipboardConsent extends ClipboardPolicy {
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

// Clipboard text is hashed so the server keeps no copy of it. CRLF is folded because Windows
// clipboards hand back LF text with CRLF line endings.
const textHash = (text: string) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

// Reading the clipboard can expose whatever the user copied (passwords, tokens; a VM may even
// share the host's clipboard), unlike every other Computer Use read, which is scoped to an app the
// thread was granted. So the permission mode never allows it: a thread reads without asking only
// while the clipboard still holds the text its agent last wrote, and anything else asks once with
// an access card whose answer stands for the thread until the server restarts. Owned by
// ComputerAccess.
export function makeClipboardConsent<E>(deps: ClipboardConsentDeps<E>): ClipboardConsent {
  const answered = new Map<string, "allowed" | "denied">();
  const written = new Map<string, string>();
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
                "The agent asks to read the clipboard. It may hold content you copied, such as passwords.",
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
    recordWrite: (threadId, text) => {
      if (text === null) written.delete(threadId);
      else written.set(threadId, textHash(text));
    },
    mayRead: (threadId, text) =>
      answered.get(threadId) === "allowed" ||
      (text !== null && written.get(threadId) === textHash(text)),
    request: (request) =>
      Effect.gen(function* () {
        const known = answered.get(request.threadId);
        if (known) return known;
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
      written.delete(threadId);
      pending.delete(threadId);
    },
  };
}
