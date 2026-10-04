import { ProviderSessionRouting } from "../Services/ProviderSessionRouting";
import { ProviderTurnDispatch } from "../Services/ProviderTurnDispatch";
import { Layer } from "effect";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect } from "effect";
import { decodeInputOrValidationError, toValidationError } from "../core/providerServiceValidation";
import {
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  ProviderStartReviewInput,
} from "@glade/contracts/provider/provider";
import { carryProviderAttachmentPaths } from "../core/providerAttachmentPaths.ts";
import type { ThreadId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderTurnStartResult } from "@glade/contracts/provider/provider";
import { ProviderRuntimeBindings } from "../Services/ProviderRuntimeBindings";

export const ProviderTurnDispatchLive = Layer.effect(
  ProviderTurnDispatch,
  Effect.gen(function* () {
    const bindings = yield* ProviderRuntimeBindings;
    const { resolveRoutableSession } = yield* ProviderSessionRouting;
    const persistTurn = (
      input: { readonly threadId: ThreadId; readonly modelSelection?: unknown },
      provider: ProviderKind,
      generation: number,
      turn: ProviderTurnStartResult,
      lastRuntimeEvent: string,
      lifecycleGeneration?: string,
    ) =>
      bindings
        .persistDispatchedTurn({
          threadId: input.threadId,
          provider,
          turnId: String(turn.turnId),
          generation,
          ...(lifecycleGeneration !== undefined ? { lifecycleGeneration } : {}),
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
          lastRuntimeEvent,
        })
        .pipe(Effect.as(turn));
    const sendTurn: ProviderServiceShape["sendTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.sendTurn",
          schema: ProviderSendTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: carryProviderAttachmentPaths(rawInput, parsed.attachments ?? []),
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.sendTurn",
            "Either input text or at least one attachment is required",
          );
        }
        return yield* bindings.runTurnDispatch(input.threadId, (generation) =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.sendTurn",
              allowRecovery: true,
            });
            if (
              input.expectedLifecycleGeneration !== undefined &&
              routed.lifecycleGeneration !== input.expectedLifecycleGeneration
            )
              return yield* toValidationError(
                "ProviderService.sendTurn",
                "The destination session changed before delivery.",
              );
            const turn = yield* routed.adapter.sendTurn(input);
            return yield* persistTurn(
              input,
              routed.adapter.provider,
              generation,
              turn,
              "provider.sendTurn",
              routed.lifecycleGeneration,
            );
          }),
        );
      });

    const steerTurn: ProviderServiceShape["steerTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.steerTurn",
          schema: ProviderSteerTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: carryProviderAttachmentPaths(rawInput, parsed.attachments ?? []),
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.steerTurn",
            "Either input text or at least one attachment is required",
          );
        }
        return yield* bindings.runTurnDispatch(input.threadId, (generation) =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.steerTurn",
              allowRecovery: true,
            });
            if (
              !routed.adapter.steerTurn ||
              routed.adapter.capabilities.supportsTurnSteering !== true
            ) {
              return yield* toValidationError(
                "ProviderService.steerTurn",
                `Provider '${routed.adapter.provider}' does not support steering an active turn.`,
              );
            }
            const turn = yield* routed.adapter.steerTurn(input);
            return yield* persistTurn(
              input,
              routed.adapter.provider,
              generation,
              turn,
              "provider.steerTurn",
              routed.lifecycleGeneration,
            );
          }),
        );
      });

    const startReview: ProviderServiceShape["startReview"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.startReview",
          schema: ProviderStartReviewInput,
          payload: rawInput,
        });

        return yield* bindings.runTurnDispatch(input.threadId, (generation) =>
          Effect.gen(function* () {
            const routed = yield* resolveRoutableSession({
              threadId: input.threadId,
              operation: "ProviderService.startReview",
              allowRecovery: true,
            });
            if (!routed.adapter.startReview) {
              return yield* toValidationError(
                "ProviderService.startReview",
                `Provider '${routed.adapter.provider}' does not support native review.`,
              );
            }

            const turn = yield* routed.adapter.startReview(input);
            return yield* persistTurn(
              input,
              routed.adapter.provider,
              generation,
              turn,
              "provider.startReview",
              routed.lifecycleGeneration,
            );
          }),
        );
      });

    return { sendTurn, steerTurn, startReview };
  }),
);
