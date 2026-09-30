import type { OnElicitation } from "@anthropic-ai/claude-agent-sdk";
import type { Fiber } from "effect";
import { Effect, Random, Deferred } from "effect";
import { EventId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { ProviderAdapterRequestError } from "../../core/Errors.ts";
import { prepareMcpElicitation } from "../../core/mcpElicitation.ts";
import {
  type ClaudeSessionContext,
  type PendingUserInput,
  type PendingUserInputResult,
  PROVIDER,
} from "./sessionTypes";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { asRuntimeRequestId } from "./messageContent";

export function makeClaudeElicitation(input: {
  readonly getContext: () => Effect.Effect<ClaudeSessionContext | undefined>;
  readonly runSdkPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly runSdkFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly settlePendingUserInput: (
    context: ClaudeSessionContext,
    requestId: ApprovalRequestId,
    pending: PendingUserInput,
    result: PendingUserInputResult,
  ) => Effect.Effect<PendingUserInputResult>;
}): OnElicitation {
  const {
    getContext,
    runSdkPromise,
    runSdkFork,
    makeEventStamp,
    offerRuntimeEvent,
    settlePendingUserInput,
  } = input;
  const onElicitation: OnElicitation = (request, options) =>
    runSdkPromise(
      Effect.gen(function* () {
        const context = yield* getContext();
        if (!context || context.stopped || options.signal.aborted)
          return { action: "cancel" as const };
        const elicitation = yield* Effect.try({
          try: () => prepareMcpElicitation(request),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "mcp/elicitation/request",
              detail: cause instanceof Error ? cause.message : "Invalid MCP request.",
              cause,
            }),
        });
        const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
        const result = yield* Deferred.make<PendingUserInputResult>();
        const settled = yield* Deferred.make<PendingUserInputResult>();
        const pending: PendingUserInput = {
          questions: elicitation.questions,
          elicitation,
          result,
          settled,
          settlementStarted: false,
          ...(context.turnState ? { turnId: context.turnState.turnId } : {}),
        };
        context.pendingUserInputs.set(requestId, pending);
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "user-input.requested",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { questions: elicitation.questions },
          raw: { source: "claude.sdk.permission", method: "onElicitation", payload: request },
        });
        const cancel = () =>
          runSdkFork(
            settlePendingUserInput(context, requestId, pending, { answers: {}, cancelled: true }),
          );
        options.signal.addEventListener("abort", cancel, { once: true });
        if (options.signal.aborted) cancel();
        const response = yield* Deferred.await(result).pipe(
          Effect.timeoutOption("5 minutes"),
          Effect.ensuring(Effect.sync(() => options.signal.removeEventListener("abort", cancel))),
        );
        if (response._tag === "None") {
          yield* settlePendingUserInput(context, requestId, pending, {
            answers: {},
            cancelled: true,
          });
          return { action: "cancel" as const };
        }
        return response.value.cancelled
          ? { action: "cancel" as const }
          : elicitation.respond(response.value.answers);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Claude MCP elicitation failed", { cause }).pipe(
            Effect.as({ action: "cancel" as const }),
          ),
        ),
      ),
    );
  return onElicitation;
}
