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
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { Deferred, Effect, Layer, Option, Stream } from "effect";
import { randomUUID } from "node:crypto";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { makeAppIdentities } from "../appIdentities.ts";
import {
  makeComputerGrants,
  scopeCovers,
  type ComputerGrant,
  type ComputerTarget,
} from "../computerGrants.ts";
import { makeComputerProgressGuard } from "../computerProgressGuard.ts";
import { makeComputerTasks } from "../computerTask.ts";
import { makeWindowSnapshots } from "../windowSnapshots.ts";
import {
  ComputerAccess,
  type ComputerAccessOutcome,
  type ComputerAccessShape,
} from "../Services/ComputerAccess.ts";
import { ComputerHost } from "../Services/ComputerHost.ts";

interface PendingAccess {
  readonly threadId: string;
  readonly target: ComputerTarget;
  readonly scope: ComputerAccessScope;
  readonly windowTitle: string | null;
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

const AUTO_GRANT_TEXT: Record<ComputerAccessScope, string> = {
  read: "Read access",
  act: "Act access",
  full: "Full control",
};
const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  "approval-required": "Ask for approval",
  auto: "Approve for me",
  "full-access": "Full access",
};

// What the thread's permission mode grants on first use without a card: Full access grants full
// control (terminals and IDEs included; browsers stay read-only by category), Auto grants
// background input and still asks once for full control, Ask for approval always asks.
const autoScopeFor = (mode: RuntimeMode, scope: ComputerAccessScope): ComputerAccessScope | null =>
  mode === "full-access" ? "full" : mode === "auto" && scope !== "full" ? "act" : null;

const scopeForAnswer = (answer: unknown): ComputerAccessScope | "deny" | null => {
  const label = Array.isArray(answer) ? answer[0] : answer;
  for (const [scope, text] of Object.entries(COMPUTER_ACCESS_ANSWERS)) {
    if (label === text) return scope as ComputerAccessScope | "deny";
  }
  return null;
};

const targetKey = (threadId: string, target: ComputerTarget) =>
  `${threadId}\u0000${target.app.toLowerCase()}\u0000${target.windowId ?? "*"}`;
const appKey = (threadId: string, app: string) => targetKey(threadId, { app, windowId: null });

export const ComputerAccessLive = Layer.effect(
  ComputerAccess,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const host = yield* ComputerHost;
    const grants = makeComputerGrants();
    const tasks = makeComputerTasks();
    const snapshots = makeWindowSnapshots();
    const progress = makeComputerProgressGuard();
    const apps = makeAppIdentities();
    const pendingById = new Map<string, PendingAccess>();
    const pendingIdByTarget = new Map<string, string>();
    // Apps whose full-control card the user answered in this thread (by appKey); in Auto that
    // answer stands for later full requests instead of a new card.
    const fullAnswered = new Set<string>();

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

    const appendResolved = (threadId: string, requestId: string, answers: Record<string, string>) =>
      appendActivity(threadId, {
        tone: "approval",
        kind: "user-input.resolved",
        summary: "Computer Use access answered",
        turnId: null,
        payload: { requestId, answers },
      });

    // An unknown thread (deleted mid-call) gets no automatic grants.
    const runtimeModeOf = (threadId: string) =>
      engine
        .getReadModel()
        .pipe(
          Effect.map(
            (readModel): RuntimeMode =>
              readModel.threads.find((thread) => thread.id === threadId)?.runtimeMode ??
              "approval-required",
          ),
        );

    // Cards still open for what an automatic grant now covers (asked before the mode changed)
    // close as granted, so no question is left waiting in the chat.
    const settleCardsCoveredBy = (threadId: string, grant: ComputerGrant) =>
      Effect.forEach(
        [...pendingById].filter(
          ([, pending]) =>
            pending.threadId === threadId &&
            pending.target.app.toLowerCase() === grant.app.toLowerCase() &&
            scopeCovers(grant.scope, pending.scope),
        ),
        ([requestId, pending]) =>
          Effect.gen(function* () {
            pendingById.delete(requestId);
            pendingIdByTarget.delete(targetKey(threadId, pending.target));
            yield* Deferred.succeed(pending.outcome, { status: "granted", scope: grant.scope });
            yield* appendResolved(threadId, requestId, {
              [COMPUTER_ACCESS_QUESTION_ID]: COMPUTER_ACCESS_ANSWERS[grant.scope],
            });
          }),
        { discard: true },
      );

    const resolveGrant = (request: Parameters<ComputerAccessShape["grantFor"]>[0]) =>
      Effect.gen(function* () {
        const target: ComputerTarget = { app: request.app, windowId: request.windowId };
        const existing = grants.check(request.threadId, target, request.scope);
        if (existing) return { grant: existing, mode: null };
        const mode = yield* runtimeModeOf(request.threadId);
        const autoScope = autoScopeFor(mode, request.scope);
        // A denial in this thread is the user's explicit choice and outranks the mode.
        const denied =
          grants.denied(request.threadId, target) ||
          grants.denied(request.threadId, { app: request.app, windowId: null });
        if (autoScope === null || denied) return { grant: null, mode };
        const grant: ComputerGrant = {
          app: request.app,
          windowId: null,
          windowTitle: null,
          scope: autoScope,
          grantedAt: new Date().toISOString(),
          autoGrantedIn: mode,
        };
        // Re-checked after reading the mode and recorded without yielding, so concurrent calls
        // record and announce one grant.
        const raced = grants.check(request.threadId, target, request.scope);
        if (raced) return { grant: raced, mode };
        grants.grant(request.threadId, grant);
        yield* settleCardsCoveredBy(request.threadId, grant).pipe(
          Effect.andThen(
            appendActivity(request.threadId, {
              tone: "info",
              kind: "computer.access.granted",
              summary: `Access granted · ${request.app}`,
              turnId: request.turnId === null ? null : TurnId.makeUnsafe(request.turnId),
              payload: {
                detail: `${AUTO_GRANT_TEXT[autoScope]} without asking: this chat runs in ${RUNTIME_MODE_LABEL[mode]}.`,
              },
            }),
          ),
          Effect.catch((error) =>
            Effect.logWarning("computer automatic grant activity failed", {
              error: String(error),
            }),
          ),
        );
        return { grant, mode };
      });

    const grantFor: ComputerAccessShape["grantFor"] = (request) =>
      resolveGrant(request).pipe(Effect.map(({ grant }) => grant));

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
        const { grant, mode } = yield* resolveGrant(request);
        if (grant) return { status: "granted", scope: grant.scope } as const;
        if (grants.denied(request.threadId, target)) return { status: "denied" } as const;
        // Auto asks for full control once per app: a lower answer stands while its grant lasts.
        const lower = grants.check(request.threadId, target, "read");
        if (mode === "auto" && lower && fullAnswered.has(appKey(request.threadId, request.app))) {
          return { status: "granted", scope: lower.scope } as const;
        }

        const key = targetKey(request.threadId, target);
        let requestId = pendingIdByTarget.get(key);
        if (!requestId || !pendingById.has(requestId)) {
          requestId = yield* openCard(request);
          pendingById.set(requestId, {
            threadId: request.threadId,
            target,
            scope: request.scope,
            windowTitle: request.windowTitle,
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
        // An answer only settles a request of the thread it was given in.
        const candidate = pendingById.get(requestId);
        const pending = candidate?.threadId === threadId ? candidate : undefined;
        const answer = scopeForAnswer(answers[COMPUTER_ACCESS_QUESTION_ID]);
        if (pending && answer) {
          pendingById.delete(requestId);
          pendingIdByTarget.delete(targetKey(pending.threadId, pending.target));
          if (pending.scope === "full") fullAnswered.add(appKey(threadId, pending.target.app));
          if (answer === "deny") {
            grants.deny(pending.threadId, pending.target);
            yield* Deferred.succeed(pending.outcome, { status: "denied" });
          } else {
            grants.grant(pending.threadId, {
              ...pending.target,
              windowTitle: pending.target.windowId === null ? null : pending.windowTitle,
              scope: answer,
              grantedAt: new Date().toISOString(),
              autoGrantedIn: null,
            });
            yield* Deferred.succeed(pending.outcome, { status: "granted", scope: answer });
          }
        } else {
          // A card from before a server restart or an unreadable (typed) answer: settle the card so
          // it closes; the agent asks again if it still needs access, which opens a fresh card.
          if (pending) {
            pendingById.delete(requestId);
            pendingIdByTarget.delete(targetKey(pending.threadId, pending.target));
            yield* Deferred.succeed(pending.outcome, { status: "pending" });
          }
          yield* Effect.logWarning("computer access answer had no open request", { requestId });
        }
        yield* appendResolved(threadId, requestId, answers as Record<string, string>);
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
            for (const key of fullAnswered) {
              if (key.startsWith(`${event.payload.threadId}\u0000`)) fullAnswered.delete(key);
            }
            tasks.clearThread(event.payload.threadId);
            snapshots.clearThread(event.payload.threadId);
            progress.clearThread(event.payload.threadId);
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

    // The kill switch stops every turn that is still using the computer the same way the chat's
    // Stop does (an interrupt, which the timeline shows and which stops the Cua calls below), and
    // ends every Cua session at once so held input is released even before the interrupt lands.
    const killAll = Effect.gen(function* () {
      const running = tasks.activeTurns();
      for (const { threadId, turnId } of running) tasks.stop(threadId, turnId);
      yield* host.endAllSessions;
      const readModel = yield* engine.getReadModel();
      const live = running.filter(({ threadId, turnId }) =>
        readModel.threads.some(
          (thread) => thread.id === threadId && thread.session?.activeTurnId === turnId,
        ),
      );
      yield* Effect.logInfo("computer kill switch", { threads: live.length });
      yield* Effect.forEach(
        live,
        ({ threadId, turnId }) =>
          engine
            .dispatch({
              type: "thread.turn.interrupt",
              commandId: CommandId.makeUnsafe(`server:computer-kill-switch:${randomUUID()}`),
              threadId: ThreadId.makeUnsafe(threadId),
              turnId: TurnId.makeUnsafe(turnId),
              createdAt: new Date().toISOString(),
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("computer kill switch interrupt failed", {
                  threadId,
                  error: String(error),
                }),
              ),
            ),
        { discard: true },
      );
    });
    yield* host.killSwitch.pipe(
      Stream.runForEach(() => killAll),
      Effect.catchCause((cause) =>
        Effect.logError("computer kill switch loop stopped", { cause: String(cause) }),
      ),
      Effect.forkScoped,
    );

    return {
      grants,
      tasks,
      snapshots,
      progress,
      apps,
      grantFor,
      requestAccess,
    } satisfies ComputerAccessShape;
  }),
);
