import { ServerConfig } from "../../server/config";
import { sanitizeDiagnosticValue } from "../../agentGateway/diagnosticSanitizer";
import { createHash } from "node:crypto";
import { CommandId, EventId } from "@glade/contracts/core/baseSchemas";
import {
  HandoffRecord,
  type HandoffPreparation as PreparedRecord,
} from "@glade/contracts/orchestration/threadEntities";
import { Effect, Fiber, Layer, Option, Schema, Cause, Exit, type ServiceMap } from "effect";
import { HandoffPreparation } from "../Services/HandoffPreparation";
import { HandoffGeneration } from "../../provider/Services/HandoffGeneration";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore";
import { ServerSettingsService } from "../../settings/serverSettings";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService";
import { ProviderValidationError } from "../../provider/core/Errors";
import { readHandoffEvidenceSnapshot } from "../handoff/sourceSnapshot";
import { makeKeyedLock } from "../../provider/core/keyedLock";
import {
  HANDOFF_GOAL,
  handoffEvidence,
  handoffInputIdentity,
  handoffAllowance,
  estimateHandoffTokens,
  validateHandoffRecord,
} from "../handoff/contextPolicy";

import { buildPreparedHandoffContext } from "../handoff/preparedContext";

import { prepareEvidenceRecord } from "../handoff/evidencePreparation";

import { preparationUsage } from "../handoff/preparationUsage";

function contextTokens(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
  if (!match) return undefined;
  return (
    Number(match[1]) *
    (match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1)
  );
}

export const HandoffPreparationLive = Layer.effect(
  HandoffPreparation,
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const eventStore = yield* OrchestrationEventStore;
    const generation = yield* HandoffGeneration;
    const settingsService = yield* ServerSettingsService;
    const discovery = yield* ProviderDiscoveryService;
    const config = yield* ServerConfig;
    const locks = makeKeyedLock();
    const running = new Map<string, Fiber.Fiber<string | null, ProviderValidationError>>();

    const prepare: ServiceMap.Service.Shape<typeof HandoffPreparation>["prepare"] = (input) =>
      locks
        .withLock(
          input.threadId,
          Effect.gen(function* () {
            const shell = Option.getOrUndefined(yield* query.getThreadShellById(input.threadId));
            if (!shell?.handoff || shell.handoff.bootstrapStatus === "completed") return null;
            const thread = Option.getOrUndefined(yield* query.getThreadDetailById(input.threadId));
            if (!thread || thread.deletedAt !== null)
              return yield* new ProviderValidationError({
                operation: "handoff.prepare",
                issue: "Destination chat is unavailable.",
              });
            const handoff = thread.handoff;
            if (!handoff || handoff.bootstrapStatus === "completed") return null;
            const currentSource = Option.getOrUndefined(
              yield* query.getThreadShellById(handoff.sourceThreadId),
            );
            if (!currentSource)
              return yield* new ProviderValidationError({
                operation: "handoff.prepare",
                issue:
                  "The source chat was deleted or is unavailable. Restore it before retrying handoff.",
              });
            const boundary = handoff.sourceBoundarySequence;
            if (boundary === undefined)
              return yield* new ProviderValidationError({
                operation: "handoff.prepare",
                issue:
                  "This older handoff has no frozen source boundary. Create a new handoff from the original chat; its transcript has been preserved.",
              });
            const source = yield* readHandoffEvidenceSnapshot(
              eventStore,
              handoff.sourceThreadId,
              boundary,
            );
            const selection = input.modelSelection ?? thread.modelSelection;
            const settings = yield* settingsService.getSettings;
            if (!settings.providers[selection.provider].enabled)
              return yield* new ProviderValidationError({
                operation: "handoff.prepare",
                issue: "Enable the destination provider before preparing the handoff.",
              });
            const providerOptions = {
              codex: {
                binaryPath: settings.providers.codex.binaryPath,
                homePath: settings.providers.codex.homePath,
                ...input.providerOptions?.codex,
              },
              claudeAgent: {
                binaryPath: settings.providers.claudeAgent.binaryPath,
                ...input.providerOptions?.claudeAgent,
              },
            };
            const catalog = yield* discovery.listModels({
              provider: selection.provider,
              binaryPath:
                selection.provider === "codex"
                  ? providerOptions.codex.binaryPath
                  : providerOptions.claudeAgent.binaryPath,
            });
            const model = catalog.models.find(
              (model) => model.slug === selection.model || model.resolvedModel === selection.model,
            );
            const selectedContext =
              selection.provider === "claudeAgent" ? selection.options?.contextWindow : undefined;
            const window =
              model?.contextWindowOptions?.find(
                (option) => option.value === (selectedContext ?? model.defaultContextWindow),
              ) ?? model?.contextWindowOptions?.find((option) => option.isDefault);
            const allowance = handoffAllowance({
              contextWindowTokens: contextTokens(window?.value),
              latestRequest: input.latestRequest,
              attachmentCount: input.attachmentCount,
            });
            if (allowance < 2_000)
              return yield* new ProviderValidationError({
                operation: "handoff.prepare",
                issue:
                  "The latest request and attachments leave insufficient destination context for the handoff. Shorten the request or choose a larger supported context.",
              });
            const goal = handoff.continuationGoal ?? HANDOFF_GOAL;
            const identity = handoffInputIdentity({
              source,
              boundary,
              goal,
              modelSelection: selection,
            });
            const evidence = handoffEvidence(source, boundary);
            const checkEnvelope = (prepared: PreparedRecord) =>
              buildPreparedHandoffContext({
                source,
                boundary,
                goal,
                record: prepared.record,
                budget: allowance,
                maxChars: 100_000 - (input.latestRequest?.length ?? 0),
                attachmentsDir: config.attachmentsDir,
              });
            if (
              handoff.preparation?.inputIdentity === identity &&
              handoff.preparation.formatVersion === 1
            ) {
              yield* Effect.try({
                try: () => {
                  validateHandoffRecord(handoff.preparation!.record, evidence);
                  checkEnvelope(handoff.preparation!);
                },
                catch: (cause) =>
                  Schema.is(ProviderValidationError)(cause)
                    ? cause
                    : new ProviderValidationError({
                        operation: "handoff.prepare",
                        issue: "Invalid handoff evidence or context budget.",
                        cause,
                      }),
              });
              return checkEnvelope(handoff.preparation);
            }
            const startedAt = Date.now();
            const publish = (status: string, summary: string, payload: object = {}) =>
              engine.dispatch({
                type: "thread.activity.append",
                commandId: CommandId.makeUnsafe(
                  `server:handoff:${input.threadId}:${status}:${Date.now()}`,
                ),
                threadId: input.threadId,
                activity: {
                  id: EventId.makeUnsafe(`handoff:${status}:${crypto.randomUUID()}`),
                  kind: `handoff.preparation.${status}`,
                  tone: status === "failed" ? "error" : "info",
                  summary,
                  payload: { inputIdentity: identity, ...payload },
                  turnId: null,
                  createdAt: new Date().toISOString(),
                },
                createdAt: new Date().toISOString(),
              });
            yield* publish("started", "Preparing handoff context with the destination model.");
            let {
              passes,
              estimatedInputTokens,
              estimatedOutputTokens,
              nativeInputTokens,
              nativeOutputTokens,
            } = preparationUsage(thread.activities, identity);
            const generate = (prompt: string) =>
              Effect.gen(function* () {
                const promptIdentity = createHash("sha256").update(prompt).digest("hex");
                const cached = thread.activities.findLast(
                  (activity) =>
                    activity.kind === "handoff.preparation.pass" &&
                    typeof activity.payload === "object" &&
                    activity.payload !== null &&
                    "promptIdentity" in activity.payload &&
                    activity.payload.promptIdentity === promptIdentity &&
                    "validEvidence" in activity.payload &&
                    activity.payload.validEvidence === true &&
                    "inputIdentity" in activity.payload &&
                    activity.payload.inputIdentity === identity,
                );
                if (
                  cached &&
                  typeof cached.payload === "object" &&
                  cached.payload !== null &&
                  "record" in cached.payload
                ) {
                  return yield* Schema.decodeUnknownEffect(HandoffRecord)(
                    cached.payload.record,
                  ).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ProviderValidationError({
                          operation: "handoff.prepare",
                          issue: "Cached handoff record is invalid.",
                          cause,
                        }),
                    ),
                  );
                }
                const passStarted = Date.now();
                passes += 1;
                estimatedInputTokens += estimateHandoffTokens(prompt);
                yield* publish("request", "Preparing a bounded handoff evidence pass.", {
                  promptIdentity,
                  estimatedInputTokens: estimateHandoffTokens(prompt),
                  modelSelection: selection,
                });
                const result = yield* generation.generate({
                  prompt,
                  modelSelection: selection,
                  providerOptions,
                });
                nativeInputTokens =
                  nativeInputTokens !== null && result.inputTokens !== null
                    ? nativeInputTokens + result.inputTokens
                    : null;
                nativeOutputTokens =
                  nativeOutputTokens !== null && result.outputTokens !== null
                    ? nativeOutputTokens + result.outputTokens
                    : null;
                const validation = yield* Effect.try({
                  try: () => validateHandoffRecord(result.record, evidence),
                  catch: (cause) =>
                    new ProviderValidationError({
                      operation: "handoff.prepare",
                      issue:
                        "Destination preparation returned invalid original evidence. Retry preparation.",
                      cause,
                    }),
                }).pipe(Effect.result);
                estimatedOutputTokens += estimateHandoffTokens(JSON.stringify(result.record));
                yield* publish("pass", "Handoff evidence prepared.", {
                  promptIdentity,
                  record: result.record,
                  validEvidence: validation._tag === "Success",
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                  estimatedInputTokens: estimateHandoffTokens(prompt),
                  estimatedOutputTokens: estimateHandoffTokens(JSON.stringify(result.record)),
                  elapsedMs: Date.now() - passStarted,
                });
                yield* Effect.try({
                  try: () => {
                    if (validation._tag === "Failure") throw validation.failure;
                  },
                  catch: (cause) =>
                    Schema.is(ProviderValidationError)(cause)
                      ? cause
                      : new ProviderValidationError({
                          operation: "handoff.prepare",
                          issue: "Invalid handoff evidence or context budget.",
                          cause,
                        }),
                });
                return result.record;
              }).pipe(
                Effect.mapError((cause) =>
                  Schema.is(ProviderValidationError)(cause)
                    ? cause
                    : new ProviderValidationError({
                        operation: "handoff.prepare",
                        issue: "Could not save a handoff preparation pass.",
                        cause,
                      }),
                ),
              );
            const work = Effect.gen(function* () {
              const preparationBudget = Math.min(
                96_000,
                Math.max(0, Math.floor((contextTokens(window?.value) ?? 64_000) * 0.8) - 16_000),
              );
              const record = yield* prepareEvidenceRecord({
                evidence,
                goal,
                preparationBudget,
                generate,
              });
              const preparation: PreparedRecord = {
                formatVersion: 1,
                inputIdentity: identity,
                goal,
                modelSelection: selection,
                record,
                passes,
                estimatedInputTokens,
                estimatedOutputTokens,
                inputTokens: nativeInputTokens,
                outputTokens: nativeOutputTokens,
                elapsedMs: Date.now() - startedAt,
              };
              yield* Effect.try({
                try: () => checkEnvelope(preparation),
                catch: (cause) =>
                  Schema.is(ProviderValidationError)(cause)
                    ? cause
                    : new ProviderValidationError({
                        operation: "handoff.prepare",
                        issue: "Invalid handoff evidence or context budget.",
                        cause,
                      }),
              });
              const current = Option.getOrUndefined(
                yield* query.getThreadShellById(input.threadId),
              );
              if (
                !current ||
                current.handoff?.sourceBoundarySequence !== boundary ||
                current.handoff.bootstrapStatus !== "pending" ||
                current.handoff.continuationGoal !== handoff.continuationGoal ||
                JSON.stringify(current.modelSelection) !== JSON.stringify(thread.modelSelection)
              )
                return yield* new ProviderValidationError({
                  operation: "handoff.prepare",
                  issue:
                    "The destination changed while preparing the handoff. Retry from its current state.",
                });
              yield* engine.dispatch({
                type: "thread.meta.update",
                commandId: CommandId.makeUnsafe(
                  `server:handoff:prepared:${input.threadId}:${identity}`,
                ),
                threadId: input.threadId,
                handoff: { ...handoff, preparation },
              });
              yield* publish(
                "completed",
                "Handoff context is ready. Send your message to continue.",
                {
                  passes,
                  estimatedInputTokens,
                  estimatedOutputTokens,
                  inputTokens: nativeInputTokens,
                  outputTokens: nativeOutputTokens,
                  estimatedTargetInputTokens: estimateHandoffTokens(checkEnvelope(preparation)),
                  elapsedMs: preparation.elapsedMs,
                  allowanceTokens: allowance,
                  tokenEstimate: "UTF-8 bytes; conservative estimate, not native usage",
                },
              );
              return checkEnvelope(preparation);
            }).pipe(
              Effect.timeout("15 minutes"),
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.uninterruptible(
                      publish(
                        Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed",
                        Cause.hasInterruptsOnly(exit.cause)
                          ? "Handoff preparation cancelled. The source and draft are intact."
                          : "Handoff preparation failed. Retry to continue; the source and draft are intact.",
                        {
                          detail: Cause.hasInterruptsOnly(exit.cause)
                            ? "Cancelled"
                            : sanitizeDiagnosticValue(Cause.pretty(exit.cause)),
                        },
                      ),
                    ),
              ),
            );
            const fiber = yield* Effect.forkChild(
              work.pipe(
                Effect.mapError((cause) =>
                  Schema.is(ProviderValidationError)(cause)
                    ? cause
                    : new ProviderValidationError({
                        operation: "handoff.prepare",
                        issue:
                          "Handoff preparation did not complete. Retry or choose a larger destination context.",
                        cause,
                      }),
                ),
              ),
            );
            running.set(input.threadId, fiber);
            return yield* Fiber.await(fiber).pipe(
              Effect.flatMap((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.succeed(exit.value)
                  : Cause.hasInterruptsOnly(exit.cause)
                    ? Effect.fail(
                        new ProviderValidationError({
                          operation: "handoff.prepare",
                          issue: "Handoff preparation cancelled. The source and draft are intact.",
                        }),
                      )
                    : Effect.failCause(exit.cause),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  running.delete(input.threadId);
                }),
              ),
            );
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            Schema.is(ProviderValidationError)(cause)
              ? cause
              : new ProviderValidationError({
                  operation: "handoff.prepare",
                  issue:
                    "Could not prepare the frozen handoff context. Retry preparation; the source and draft are intact.",
                  cause,
                }),
          ),
        );
    return {
      prepare,
      cancel: (threadId) =>
        Effect.gen(function* () {
          const fiber = running.get(threadId);
          if (!fiber) {
            const thread = Option.getOrUndefined(yield* query.getThreadDetailById(threadId));
            const last = thread?.activities.findLast((activity) =>
              activity.kind.startsWith("handoff.preparation."),
            );
            if (
              thread?.handoff?.bootstrapStatus !== "pending" ||
              !last ||
              ![
                "handoff.preparation.started",
                "handoff.preparation.request",
                "handoff.preparation.pass",
              ].includes(last.kind)
            )
              return false;
            const date = new Date().toISOString();
            yield* engine.dispatch({
              type: "thread.activity.append",
              commandId: CommandId.makeUnsafe(`server:handoff:cancel:${crypto.randomUUID()}`),
              threadId,
              createdAt: date,
              activity: {
                id: EventId.makeUnsafe(`handoff:cancel:${crypto.randomUUID()}`),
                kind: "handoff.preparation.cancelled",
                tone: "info",
                summary:
                  "Interrupted preparation cleared. Retry to reuse completed evidence passes.",
                payload: {},
                turnId: null,
                createdAt: date,
              },
            });
            return true;
          }
          yield* Fiber.interrupt(fiber);
          return true;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderValidationError({
                operation: "handoff.cancel",
                issue: "Could not cancel handoff preparation.",
                cause,
              }),
          ),
        ),
    };
  }),
);
