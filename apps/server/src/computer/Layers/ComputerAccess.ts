import { CommandId, EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import {
  COMPUTER_ACCESS_ANSWERS,
  COMPUTER_ACCESS_QUESTION_ID,
  COMPUTER_ACCESS_REQUEST_PREFIX,
  isComputerAccessRequestId,
  type ComputerAccessRequestDetails,
  type ComputerAccessScope,
} from "@glade/contracts/computer/computerUse";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { Deferred, Effect, Layer, Option, Stream } from "effect";
import { randomUUID } from "node:crypto";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { makeComputerGrants, type ComputerTarget } from "../computerGrants.ts";
import { makeComputerTasks } from "../computerTask.ts";
import {
  ComputerAccess,
  type ComputerAccessOutcome,
  type ComputerAccessShape,
} from "../Services/ComputerAccess.ts";
import { ComputerHost } from "../Services/ComputerHost.ts";

interface PendingAccess {
  readonly threadId: string;
  readonly target: ComputerTarget;
  readonly outcome: Deferred.Deferred<ComputerAccessOutcome>;
}

const SCOPE_VERB: Record<ComputerAccessScope, string> = {
  read: "see",
  act: "use",
  full: "take full control of",
};

const OPTION_DESCRIPTIONS = {
  read: "See its windows and accessibility tree and take screenshots; no input.",
  act: "Also click, type and scroll in the background without taking focus.",
  full: "Also bring it to the front and drive the real pointer and keyboard.",
  deny: "Refuse; the agent will not ask again for this app in this thread.",
} as const;

const scopeForAnswer = (answer: unknown): ComputerAccessScope | "deny" | null => {
  const label = Array.isArray(answer) ? answer[0] : answer;
  for (const [scope, text] of Object.entries(COMPUTER_ACCESS_ANSWERS)) {
    if (label === text) return scope as ComputerAccessScope | "deny";
  }
  return null;
};

const targetKey = (threadId: string, target: ComputerTarget) =>
  `${threadId}\u0000${target.app.toLowerCase()}\u0000${target.windowId ?? "*"}`;

export const ComputerAccessLive = Layer.effect(
  ComputerAccess,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const host = yield* ComputerHost;
    const grants = makeComputerGrants();
    const tasks = makeComputerTasks();
    const pendingById = new Map<string, PendingAccess>();
    const pendingIdByTarget = new Map<string, string>();

    const appendActivity = (
      threadId: string,
      activity: Omit<OrchestrationThreadActivity, "id" | "createdAt" | "sequence">,
    ) => {
      const createdAt = new Date().toISOString();
      return engine
        .dispatch({
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(`server:computer-access:${randomUUID()}`),
          threadId: ThreadId.makeUnsafe(threadId),
          activity: { ...activity, id: EventId.makeUnsafe(randomUUID()), createdAt },
          createdAt,
        })
        .pipe(Effect.asVoid);
    };

    const openCard = (request: Parameters<ComputerAccessShape["requestAccess"]>[0]) =>
      Effect.gen(function* () {
        const requestId = `${COMPUTER_ACCESS_REQUEST_PREFIX}${randomUUID()}`;
        const window = request.windowTitle ? ` (window "${request.windowTitle}")` : "";
        const details: ComputerAccessRequestDetails = {
          app: request.app,
          windowId: request.windowId,
          windowTitle: request.windowTitle,
          scope: request.scope,
          reason: request.reason,
        };
        yield* appendActivity(request.threadId, {
          tone: "approval",
          kind: "user-input.requested",
          summary: "Computer Use access requested",
          turnId: request.turnId === null ? null : TurnId.makeUnsafe(request.turnId),
          payload: {
            requestId,
            computerAccess: details,
            questions: [
              {
                id: COMPUTER_ACCESS_QUESTION_ID,
                header: "Computer Use",
                question: `The agent asks to ${SCOPE_VERB[request.scope]} ${request.app}${window}: ${request.reason}`,
                options: (["read", "act", "full", "deny"] as const).map((key) => ({
                  label: COMPUTER_ACCESS_ANSWERS[key],
                  description: OPTION_DESCRIPTIONS[key],
                })),
                multiSelect: false,
              },
            ],
          },
        });
        return requestId;
      });

    const requestAccess: ComputerAccessShape["requestAccess"] = (request) =>
      Effect.gen(function* () {
        const target: ComputerTarget = { app: request.app, windowId: request.windowId };
        const existing = grants.check(request.threadId, target, request.scope);
        if (existing) return { status: "granted", scope: existing.scope } as const;
        if (grants.denied(request.threadId, target)) return { status: "denied" } as const;

        const key = targetKey(request.threadId, target);
        let requestId = pendingIdByTarget.get(key);
        if (!requestId || !pendingById.has(requestId)) {
          requestId = yield* openCard(request);
          pendingById.set(requestId, {
            threadId: request.threadId,
            target,
            outcome: yield* Deferred.make<ComputerAccessOutcome>(),
          });
          pendingIdByTarget.set(key, requestId);
        }
        const pending = pendingById.get(requestId)!;
        const answered = yield* Deferred.await(pending.outcome).pipe(
          Effect.timeoutOption(request.waitMs),
        );
        return Option.getOrElse(answered, () => ({ status: "pending" }) as const);
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("computer access card failed", { error: String(error) }).pipe(
            Effect.as({ status: "pending" } as const),
          ),
        ),
      );

    const answerAccess = (threadId: string, requestId: string, answers: Record<string, unknown>) =>
      Effect.gen(function* () {
        const pending = pendingById.get(requestId);
        const answer = scopeForAnswer(answers[COMPUTER_ACCESS_QUESTION_ID]);
        if (pending && answer) {
          pendingById.delete(requestId);
          pendingIdByTarget.delete(targetKey(pending.threadId, pending.target));
          if (answer === "deny") {
            grants.deny(pending.threadId, pending.target);
            yield* Deferred.succeed(pending.outcome, { status: "denied" });
          } else {
            grants.grant(pending.threadId, {
              ...pending.target,
              scope: answer,
              grantedAt: new Date().toISOString(),
            });
            yield* Deferred.succeed(pending.outcome, { status: "granted", scope: answer });
          }
        } else {
          // A card from before a server restart or an unreadable answer: settle the card so it
          // closes; the agent asks again if it still needs access.
          yield* Effect.logWarning("computer access answer had no open request", { requestId });
        }
        yield* appendActivity(threadId, {
          tone: "approval",
          kind: "user-input.resolved",
          summary: "Computer Use access answered",
          turnId: null,
          payload: { requestId, answers: answers as Record<string, string> },
        });
      });

    yield* engine.streamDomainEvents.pipe(
      Stream.runForEach((event) => {
        switch (event.type) {
          case "thread.user-input-response-requested":
            return isComputerAccessRequestId(event.payload.requestId)
              ? answerAccess(event.payload.threadId, event.payload.requestId, event.payload.answers)
              : Effect.void;
          case "thread.turn-interrupt-requested":
            tasks.stop(event.payload.threadId, event.payload.turnId);
            return host.endSession(event.payload.threadId);
          case "thread.deleted":
            grants.clearThread(event.payload.threadId);
            tasks.clearThread(event.payload.threadId);
            return Effect.void;
          default:
            return Effect.void;
        }
      }),
      Effect.catchCause((cause) =>
        Effect.logError("computer access event loop stopped", { cause: String(cause) }),
      ),
      Effect.forkScoped,
    );

    return { grants, tasks, requestAccess } satisfies ComputerAccessShape;
  }),
);
