import { makeProviderLifecycleCoordinator } from "../core/providerLifecycleCoordinator.ts";
import type { ServiceMap } from "effect";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  TargetedChildInterruptTombstone,
  ProviderInterruptionFence,
  runtimeActiveTurnId,
  InteractionResponse,
} from "../core/providerRuntimeBinding";
import { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect, Option, Exit, Cause } from "effect";
import { decodeInputOrValidationError, toValidationError } from "../core/providerServiceValidation";
import {
  ProviderInterruptTurnInput,
  ProviderStopTaskInput,
  ProviderBackgroundTaskInput,
  ProviderSteerSubagentInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
} from "@glade/contracts/provider/provider";
import { AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED } from "../../agentGateway/sessionLease.ts";
import { carryProviderAttachmentPaths } from "../core/providerAttachmentPaths.ts";
import { computerApprovalGate } from "../../computer/ComputerApprovalGate.ts";
import { ProviderValidationError } from "../core/Errors.ts";
import { makeProviderSessionRecovery } from "./sessionRecovery";
import { makeProviderInterruptionFence } from "./interruptionFence";
import { makeProviderRuntimeBinding } from "./runtimeBinding";
import { makeProviderSessionTeardown } from "./sessionTeardown";

export function makeProviderTaskControl(input: {
  readonly lifecycle: ReturnType<typeof makeProviderLifecycleCoordinator>;
  readonly resolveRoutableSession: ReturnType<
    typeof makeProviderSessionRecovery
  >["resolveRoutableSession"];
  readonly directory: ServiceMap.Service.Shape<typeof ProviderSessionDirectory>;
  readonly targetedChildInterruptKey: ReturnType<
    typeof makeProviderInterruptionFence
  >["targetedChildInterruptKey"];
  readonly targetedChildInterruptTombstones: Map<string, TargetedChildInterruptTombstone>;
  readonly withBindingWriteLock: ReturnType<
    typeof makeProviderRuntimeBinding
  >["withBindingWriteLock"];
  readonly rememberTargetedChildInterrupt: ReturnType<
    typeof makeProviderInterruptionFence
  >["rememberTargetedChildInterrupt"];
  readonly acquireProviderInterruptionFence: ReturnType<
    typeof makeProviderInterruptionFence
  >["acquireProviderInterruptionFence"];
  readonly stopRuntimeSessionInternal: ReturnType<
    typeof makeProviderSessionTeardown
  >["stopRuntimeSessionInternal"];
  readonly providerInterruptionFences: Map<ThreadId, ProviderInterruptionFence>;
}) {
  const {
    lifecycle,
    resolveRoutableSession,
    directory,
    targetedChildInterruptKey,
    targetedChildInterruptTombstones,
    withBindingWriteLock,
    rememberTargetedChildInterrupt,
    acquireProviderInterruptionFence,
    stopRuntimeSessionInternal,
    providerInterruptionFences,
  } = input;
  const interruptTurn: ProviderServiceShape["interruptTurn"] = (rawInput) =>
    Effect.gen(function* () {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.interruptTurn",
        schema: ProviderInterruptTurnInput,
        payload: rawInput,
      });
      let rotationStarted = false;
      // Urgent: an interrupt is the user's only escape hatch from a wedged turn, so it must not queue
      // behind a lifecycle mutation that hangs.
      const runInterrupt =
        input.providerThreadId === undefined ? lifecycle.runCurrentUrgent : lifecycle.runCurrent;
      const interruptActiveTurn = runInterrupt(input.threadId, (currentGeneration) =>
        Effect.gen(function* () {
          const routed = yield* resolveRoutableSession({
            threadId: input.threadId,
            operation: "ProviderService.interruptTurn",
            allowRecovery: false,
          });
          if (!routed.isActive) {
            return yield* toValidationError(
              "ProviderService.interruptTurn",
              `Cannot interrupt thread '${input.threadId}' because its provider runtime is not active.`,
            );
          }

          const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
          if (!binding) {
            return yield* toValidationError(
              "ProviderService.interruptTurn",
              `Cannot interrupt thread '${input.threadId}' without a persisted provider binding.`,
            );
          }
          const bindingGeneration = binding.lifecycleGeneration ?? currentGeneration;
          if (
            currentGeneration !== undefined &&
            bindingGeneration !== undefined &&
            bindingGeneration !== currentGeneration
          ) {
            return yield* toValidationError(
              "ProviderService.interruptTurn",
              `Cannot interrupt stale provider generation '${bindingGeneration}' for thread '${input.threadId}'.`,
            );
          }

          const boundActiveTurnId = runtimeActiveTurnId(binding.runtimePayload);
          const providerTurnId =
            input.providerThreadId !== undefined ? input.turnId : boundActiveTurnId;
          if (providerTurnId === undefined) {
            return yield* toValidationError(
              "ProviderService.interruptTurn",
              `Cannot interrupt thread '${input.threadId}' because no exact active provider turn is bound.`,
            );
          }
          if (
            input.providerThreadId === undefined &&
            input.turnId !== undefined &&
            input.turnId !== providerTurnId
          ) {
            yield* Effect.logWarning(
              "provider interrupt received stale projection turn; using authoritative active turn",
              {
                threadId: input.threadId,
                requestedTurnId: input.turnId,
                activeTurnId: providerTurnId,
                provider: routed.adapter.provider,
              },
            );
          }

          const targetedInterruptKey =
            input.providerThreadId === undefined
              ? undefined
              : targetedChildInterruptKey(
                  input.threadId,
                  TurnId.makeUnsafe(providerTurnId),
                  input.providerThreadId,
                );
          if (targetedInterruptKey !== undefined) {
            const previousTargetedInterrupt =
              targetedChildInterruptTombstones.get(targetedInterruptKey);
            if (
              previousTargetedInterrupt?.state === "confirmed" ||
              (previousTargetedInterrupt?.state === "uncertain" &&
                previousTargetedInterrupt.lifecycleGeneration !== bindingGeneration)
            ) {
              return;
            }
          }

          if (input.providerThreadId !== undefined) {
            yield* withBindingWriteLock(
              input.threadId,
              directory.upsert({
                threadId: input.threadId,
                provider: binding.provider,
                runtimePayload: {
                  [AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED]: true,
                  lastRuntimeEvent: "provider.subagentInterruptedCredentialRotationRequired",
                  lastRuntimeEventAt: new Date().toISOString(),
                },
              }),
            );
            if (targetedInterruptKey !== undefined) {
              // Tombstone at the same admission boundary: even an uncertain native failure must not let a
              // duplicate stale Stop revoke the replacement runtime's lease.
              rememberTargetedChildInterrupt(targetedInterruptKey, {
                lifecycleGeneration: bindingGeneration,
                state: "uncertain",
              });
            }
          }

          rotationStarted = input.providerThreadId === undefined;
          yield* routed.adapter.interruptTurn(
            input.threadId,
            TurnId.makeUnsafe(providerTurnId),
            input.providerThreadId,
          );
          if (targetedInterruptKey !== undefined) {
            rememberTargetedChildInterrupt(targetedInterruptKey, {
              lifecycleGeneration: bindingGeneration,
              state: "confirmed",
            });
          }
        }),
      );
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          // Publish and settle the fence inside the same masked region. If this interrupt fiber is itself
          // cancelled while runtime teardown is blocked, deferred interruption must not skip resolve/delete.
          const fence = yield* acquireProviderInterruptionFence(input.threadId);
          const rotationExit = yield* Effect.exit(
            input.providerThreadId === undefined
              ? interruptActiveTurn.pipe(
                  Effect.andThen(
                    stopRuntimeSessionInternal({ threadId: input.threadId }, undefined, {
                      requireAgentGatewayCredentialRotation: true,
                    }),
                  ),
                )
              : interruptActiveTurn,
          );
          if (Exit.isFailure(rotationExit)) {
            if (rotationStarted) {
              fence.failure = Cause.pretty(rotationExit.cause);
            } else if (providerInterruptionFences.get(input.threadId) === fence) {
              providerInterruptionFences.delete(input.threadId);
            }
            fence.resolve();
            return yield* Effect.failCause(rotationExit.cause);
          }
          if (providerInterruptionFences.get(input.threadId) === fence) {
            providerInterruptionFences.delete(input.threadId);
          }
          fence.resolve();
        }),
      );
    });

  const stopTask: ProviderServiceShape["stopTask"] = (rawInput) =>
    decodeInputOrValidationError({
      operation: "ProviderService.stopTask",
      schema: ProviderStopTaskInput,
      payload: rawInput,
    }).pipe(
      Effect.flatMap((input) =>
        lifecycle.runCurrent(input.threadId, () =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.stopTask",
              allowRecovery: false,
            });
            if (!routed.isActive) {
              return yield* toValidationError(
                "ProviderService.stopTask",
                `Cannot stop provider task '${input.taskId}' because the provider runtime is not active.`,
              );
            }
            if (!routed.adapter.stopTask) {
              return yield* toValidationError(
                "ProviderService.stopTask",
                `Provider '${routed.adapter.provider}' does not support stopping a provider task.`,
              );
            }
            yield* routed.adapter.stopTask(input.threadId, input.taskId);
          }),
        ),
      ),
    );

  const backgroundTask: ProviderServiceShape["backgroundTask"] = (rawInput) =>
    decodeInputOrValidationError({
      operation: "ProviderService.backgroundTask",
      schema: ProviderBackgroundTaskInput,
      payload: rawInput,
    }).pipe(
      Effect.flatMap((input) =>
        lifecycle.runCurrent(input.threadId, () =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.backgroundTask",
              allowRecovery: false,
            });
            if (!routed.isActive) {
              return yield* toValidationError(
                "ProviderService.backgroundTask",
                `Cannot background provider task '${input.toolUseId}' because the provider runtime is not active.`,
              );
            }
            if (!routed.adapter.backgroundTask) {
              return yield* toValidationError(
                "ProviderService.backgroundTask",
                `Provider '${routed.adapter.provider}' does not support backgrounding a provider task.`,
              );
            }
            yield* routed.adapter.backgroundTask(input.threadId, input.toolUseId);
          }),
        ),
      ),
    );

  const steerSubagent: ProviderServiceShape["steerSubagent"] = (rawInput) =>
    decodeInputOrValidationError({
      operation: "ProviderService.steerSubagent",
      schema: ProviderSteerSubagentInput,
      payload: rawInput,
    }).pipe(
      Effect.flatMap((input) =>
        lifecycle.runCurrent(input.threadId, () =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.steerSubagent",
              allowRecovery: false,
            });
            if (!routed.isActive) {
              return yield* toValidationError(
                "ProviderService.steerSubagent",
                `Cannot message subagent '${input.providerThreadId}' because the provider runtime is not active.`,
              );
            }
            if (!routed.adapter.steerSubagent) {
              return yield* toValidationError(
                "ProviderService.steerSubagent",
                `Provider '${routed.adapter.provider}' does not support messaging a running subagent.`,
              );
            }
            const attachments = carryProviderAttachmentPaths(rawInput, input.attachments ?? []);
            yield* routed.adapter.steerSubagent(input.threadId, input.providerThreadId, {
              input: input.input ?? "",
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(input.skills !== undefined ? { skills: input.skills } : {}),
              ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
            });
          }),
        ),
      ),
    );

  const respondToInteraction = (response: InteractionResponse) => {
    const { input } = response;
    if (response.kind === "approval" && input.requestId.startsWith("computer:")) {
      return Effect.gen(function* () {
        if (
          !computerApprovalGate.respond(input.threadId, input.requestId, response.input.decision)
        ) {
          return yield* toValidationError(
            "ProviderService.respondToRequest",
            "This computer approval expired or belongs to another conversation.",
          );
        }
      });
    }
    const operation =
      response.kind === "approval"
        ? "ProviderService.respondToRequest"
        : "ProviderService.respondToUserInput";
    return lifecycle.runCurrent(input.threadId, (currentGeneration) =>
      Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation,
          allowRecovery: false,
        });
        if (!routed.isActive) {
          return yield* new ProviderValidationError({
            operation,
            issue: `Cannot respond to request '${input.requestId}' because the provider runtime is not active.`,
            reason: "runtime-unavailable",
          });
        }
        const routedGeneration = routed.lifecycleGeneration ?? currentGeneration;
        if (
          routedGeneration !== undefined &&
          routedGeneration !== "legacy" &&
          input.lifecycleGeneration === undefined
        ) {
          return yield* toValidationError(
            operation,
            `Cannot respond to request '${input.requestId}' without its provider lifecycle generation.`,
          );
        }
        if (
          input.lifecycleGeneration !== undefined &&
          input.lifecycleGeneration !== routedGeneration
        ) {
          return yield* new ProviderValidationError({
            operation,
            issue: `Cannot respond to stale request '${input.requestId}' from provider generation '${input.lifecycleGeneration}'.`,
            reason: "stale-interaction",
          });
        }
        if (response.kind === "approval") {
          yield* routed.adapter.respondToRequest(
            input.threadId,
            input.requestId,
            response.input.decision,
          );
          return;
        }
        yield* routed.adapter.respondToUserInput(
          input.threadId,
          input.requestId,
          response.input.answers,
        );
      }),
    );
  };

  const respondToRequest: ProviderServiceShape["respondToRequest"] = (rawInput) =>
    decodeInputOrValidationError({
      operation: "ProviderService.respondToRequest",
      schema: ProviderRespondToRequestInput,
      payload: rawInput,
    }).pipe(Effect.flatMap((input) => respondToInteraction({ kind: "approval", input })));

  const respondToUserInput: ProviderServiceShape["respondToUserInput"] = (rawInput) =>
    decodeInputOrValidationError({
      operation: "ProviderService.respondToUserInput",
      schema: ProviderRespondToUserInputInput,
      payload: rawInput,
    }).pipe(Effect.flatMap((input) => respondToInteraction({ kind: "userInput", input })));
  return {
    interruptTurn,
    stopTask,
    backgroundTask,
    steerSubagent,
    respondToRequest,
    respondToUserInput,
  };
}
