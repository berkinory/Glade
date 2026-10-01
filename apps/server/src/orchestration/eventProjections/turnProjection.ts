import {
  OrchestrationThread,
  OrchestrationSession,
} from "@glade/contracts/orchestration/threadEntities";
import { settleTurnStateFromSession, maxIso } from "../turnLifecycle.ts";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { ThreadClaudeCacheSetPayload } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import { ThreadTurnStartRequestedPayload, ThreadSessionSetPayload } from "../Schemas.ts";
import {
  deriveTurnStartModelSelection,
  canAdoptFirstTurnProvider,
  deriveTurnStartSession,
} from "../turnStartSession.ts";
import { ProjectionEffect, decodeForEvent, updateThread } from "./projectionState";

function isTerminalLatestTurn(
  latestTurn: OrchestrationThread["latestTurn"] | null | undefined,
): boolean {
  if (!latestTurn?.completedAt) {
    return false;
  }
  return latestTurn.state === "completed" || latestTurn.state === "error";
}

// Turn lifecycle must settle with the session: once a session leaves "running", no provider event
// will ever mark the turn complete on its own, so a running latestTurn is settled here. Checkpoint
// diff events (thread.turn-diff-completed) only enrich the terminal state afterwards — they are not
// the lifecycle authority. A retained activeTurnId blocks settlement (except on error):
// stop-requested flows deliberately emit "interrupted" while keeping the turn active until the
// provider's terminal event decides the real outcome, and a premature settle here could never be
// corrected because settlement only applies to running turns.
function settleLatestTurnForSessionStatus(
  latestTurn: OrchestrationThread["latestTurn"],
  session: Pick<OrchestrationSession, "status" | "activeTurnId" | "updatedAt">,
): OrchestrationThread["latestTurn"] {
  if (latestTurn?.state !== "running") {
    return latestTurn;
  }
  const settledState = settleTurnStateFromSession(session, latestTurn.state);
  if (settledState === null) {
    return latestTurn;
  }
  return {
    ...latestTurn,
    state: settledState,
    completedAt: latestTurn.completedAt ?? session.updatedAt,
  };
}

export function projectTurnEvent(
  nextBase: OrchestrationReadModel,
  event: Extract<
    OrchestrationEvent,
    { type: "thread.claude-cache-set" | "thread.turn-start-requested" | "thread.session-set" }
  >,
): ProjectionEffect {
  switch (event.type) {
    case "thread.claude-cache-set":
      return decodeForEvent(ThreadClaudeCacheSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            claudeCacheReview: payload.review,
            updatedAt: payload.updatedAt,
          }),
        })),
      );
    case "thread.turn-start-requested":
      return decodeForEvent(
        ThreadTurnStartRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          const projectedModelSelection = deriveTurnStartModelSelection({
            currentModelSelection: thread.modelSelection,
            requestedModelSelection: payload.modelSelection,
            canAdoptRequestedProvider: canAdoptFirstTurnProvider({
              hasLatestTurn: thread.latestTurn !== null,
              hasSession: thread.session !== null,
              messages: thread.messages,
            }),
          });
          const modelSelectionPatch =
            projectedModelSelection !== thread.modelSelection
              ? { modelSelection: projectedModelSelection }
              : {};
          const turnStartSession = deriveTurnStartSession({
            threadId: thread.id,
            currentSession: thread.session,
            providerName: projectedModelSelection.provider,
            requestedRuntimeMode: payload.runtimeMode,
            requestedAt: payload.createdAt,
          });
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              ...modelSelectionPatch,
              ...(turnStartSession !== null ? { session: turnStartSession } : {}),
              runtimeMode: payload.runtimeMode,

              updatedAt: payload.createdAt,
            }),
          };
        }),
      );
    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? thread.latestTurn?.turnId === session.activeTurnId &&
                  isTerminalLatestTurn(thread.latestTurn)
                  ? thread.latestTurn
                  : {
                      turnId: session.activeTurnId,
                      state: "running",
                      requestedAt:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? thread.latestTurn.requestedAt
                          : session.updatedAt,
                      startedAt:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? (thread.latestTurn.startedAt ?? session.updatedAt)
                          : session.updatedAt,
                      completedAt: null,
                      assistantMessageId:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? thread.latestTurn.assistantMessageId
                          : null,
                    }
                : settleLatestTurnForSessionStatus(thread.latestTurn, session),
            updatedAt: maxIso(thread.updatedAt, event.occurredAt),
          }),
        };
      });
  }
}
