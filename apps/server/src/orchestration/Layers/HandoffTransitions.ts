import { ProviderService } from "../../provider/Services/ProviderService";
import { CommandId, EventId } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer, Option, type ServiceMap, Schema } from "effect";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory";
import { ProviderValidationError } from "../../provider/core/Errors";
import { readHandoffSourceSnapshot } from "../handoff/sourceSnapshot";
import { redactDiagnosticValue } from "../../agentGateway/diagnosticSanitizer";

export const HandoffTransitionsLive = Layer.effect(
  HandoffTransitions,
  Effect.gen(function* () {
    const provider = yield* Effect.serviceOption(ProviderService);
    const query = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const events = yield* OrchestrationEventStore;
    const directory = yield* ProviderSessionDirectory;
    const invalid = (issue: string) =>
      new ProviderValidationError({ operation: "handoff.transition", issue });
    const current = Effect.fnUntraced(function* (
      threadId: Parameters<typeof query.getThreadShellById>[0],
      operationId: CommandId,
    ) {
      const thread = Option.getOrUndefined(yield* query.getThreadShellById(threadId));
      if (
        !thread ||
        thread.archivedAt != null ||
        thread.handoff?.operationId !== operationId ||
        thread.handoff.stage === "cancelled"
      )
        return yield* invalid("The provider transition is unavailable or was cancelled.");
      return thread;
    });
    const service: ServiceMap.Service.Shape<typeof HandoffTransitions> = {
      abort: (threadId, operationId) =>
        Effect.gen(function* () {
          const thread = yield* current(threadId, operationId);
          if (
            thread.handoff!.sourceRetired ||
            ["activating", "activated", "uncertain"].includes(thread.handoff!.stage ?? "")
          ) {
            if (Option.isNone(provider))
              return yield* invalid("Provider retirement is unavailable.");
            yield* provider.value.stopSession({ threadId });
            yield* engine.dispatch({
              type: "thread.session.set",
              createdAt: new Date().toISOString(),
              commandId: CommandId.makeUnsafe(`server:handoff:abort:${crypto.randomUUID()}`),
              threadId,
              session: {
                threadId,
                providerName: null,
                status: "stopped",
                activeTurnId: null,
                lastError: null,
                runtimeMode: thread.runtimeMode,
                updatedAt: new Date().toISOString(),
              },
            });
          }
          if (thread.handoff!.sourceRetired && thread.handoff!.sourceModelSelection)
            yield* engine.dispatch({
              type: "thread.meta.update",
              commandId: CommandId.makeUnsafe(
                `server:handoff:restore-selection:${crypto.randomUUID()}`,
              ),
              threadId,
              expectedHandoffOperationId: operationId,
              modelSelection: thread.handoff!.sourceModelSelection,
            });
          yield* service.update(threadId, operationId, {
            stage: "cancelled",
            ...(thread.handoff!.stage === "uncertain"
              ? {
                  detail:
                    "Stopped after uncertain native acceptance. Provider execution may have occurred; inspect the session and workspace before retrying.",
                }
              : {}),
          });
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ProviderValidationError)(cause)
              ? cause
              : invalid("Could not stop the provider transition."),
          ),
        ),
      validate: (threadId, operationId) =>
        Effect.gen(function* () {
          const thread = yield* current(threadId, operationId);
          const handoff = thread.handoff!;
          if (handoff.sourceBoundarySequence === undefined)
            return yield* invalid("The frozen source boundary is unavailable.");
          const frozen = yield* readHandoffSourceSnapshot(
            events,
            handoff.sourceThreadId,
            handoff.sourceBoundarySequence,
          );
          const live = yield* readHandoffSourceSnapshot(
            events,
            threadId,
            yield* events.getHighWaterSequence(),
          );
          const sourceMessages = live.messages.filter(
            (message) => message.id !== handoff.deliveryMessageId,
          );
          const evidence = (messages: typeof frozen.messages) =>
            JSON.stringify(
              messages.map((message) => ({
                id: message.id,
                text: message.text,
                attachments: message.attachments,
                role: message.role,
                turnId: message.turnId,
              })),
            );
          const sourceActivities = (activities: typeof frozen.activities) =>
            JSON.stringify(
              activities.filter(
                (activity) =>
                  !activity.kind.startsWith("handoff.preparation.") &&
                  activity.kind !== "provider.transition",
              ),
            );
          if (
            sourceActivities(live.activities) !== sourceActivities(frozen.activities) ||
            evidence(sourceMessages) !== evidence(frozen.messages) ||
            live.projectId !== frozen.projectId ||
            live.worktreePath !== frozen.worktreePath ||
            live.branch !== frozen.branch ||
            live.workingDirectory !== frozen.workingDirectory
          )
            return yield* invalid(
              "The source conversation or workspace changed. Start a new provider transition.",
            );
          if (
            !handoff.sourceRetired &&
            !["activated", "delivered", "uncertain"].includes(handoff.stage ?? "") &&
            handoff.sourceGeneration !== undefined
          ) {
            const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
            if ((binding?.lifecycleGeneration ?? null) !== handoff.sourceGeneration)
              return yield* invalid("The source session changed while preparing the transition.");
          }
          return handoff;
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ProviderValidationError)(cause)
              ? cause
              : invalid("Could not validate the provider transition."),
          ),
        ),
      update: (threadId, operationId, patch) =>
        Effect.gen(function* () {
          const thread = yield* current(threadId, operationId);
          const handoff = { ...thread.handoff!, ...patch };
          yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe(`server:handoff:stage:${crypto.randomUUID()}`),
            threadId,
            expectedHandoffOperationId: operationId,
            handoff,
          });
          yield* engine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.makeUnsafe(`server:handoff:transition:${crypto.randomUUID()}`),
            threadId,
            activity: {
              id: EventId.makeUnsafe(`handoff-transition:${operationId}`),
              kind: "provider.transition",
              tone: ["failed", "uncertain"].includes(handoff.stage) ? "error" : "info",
              summary: `${handoff.sourceProvider === "codex" ? "Codex" : "Claude"} · ${handoff.sourceModelSelection?.model ?? "default"} → ${handoff.destinationModelSelection?.provider === "codex" ? "Codex" : "Claude"} · ${handoff.destinationModelSelection?.model ?? thread.modelSelection.model}: ${handoff.stage}`,
              payload: {
                operationId,
                source: { provider: handoff.sourceProvider },
                destination: {
                  provider:
                    handoff.destinationModelSelection?.provider ?? thread.modelSelection.provider,
                },
                stage: handoff.stage,
                detail: JSON.stringify(
                  redactDiagnosticValue({
                    operationId,
                    source: handoff.sourceModelSelection ?? { provider: handoff.sourceProvider },
                    destination: handoff.destinationModelSelection,
                    stage: handoff.stage,
                    usage: handoff.preparation
                      ? {
                          passes: handoff.preparation.passes,
                          inputTokens: handoff.preparation.inputTokens,
                          outputTokens: handoff.preparation.outputTokens,
                          estimatedInputTokens: handoff.preparation.estimatedInputTokens,
                          estimatedOutputTokens: handoff.preparation.estimatedOutputTokens,
                        }
                      : undefined,
                    context: handoff.transferredContext ?? handoff.preparation?.record,
                    failure: handoff.detail,
                  }),
                  null,
                  2,
                ),
              },
              turnId: null,
              createdAt: handoff.importedAt,
            },
            createdAt: new Date().toISOString(),
          });
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ProviderValidationError)(cause)
              ? cause
              : invalid("Could not save the provider transition."),
          ),
        ),
    };
    return service;
  }),
);
