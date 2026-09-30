import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import { Effect } from "effect";
import { decodeInputOrValidationError, toValidationError } from "../core/providerServiceValidation";
import {
  ProviderSendTurnInput,
  ProviderSteerTurnInput,
  ProviderStartReviewInput,
} from "@glade/contracts/provider/provider";
import { carryProviderAttachmentPaths } from "../core/providerAttachmentPaths.ts";
import type { StartedTurnPersistenceInput } from "../core/providerRuntimeBinding.ts";
import { makeProviderRuntimeBinding } from "./runtimeBinding";
import { makeProviderSessionRecovery } from "./sessionRecovery";

export function makeProviderTurnDispatch(input: {
  readonly runTurnDispatch: ReturnType<typeof makeProviderRuntimeBinding>["runTurnDispatch"];
  readonly resolveRoutableSession: ReturnType<
    typeof makeProviderSessionRecovery
  >["resolveRoutableSession"];
  readonly rememberSuccessfulTurnDispatch: ReturnType<
    typeof makeProviderRuntimeBinding
  >["rememberSuccessfulTurnDispatch"];
  readonly persistStartedTurn: ReturnType<typeof makeProviderRuntimeBinding>["persistStartedTurn"];
}) {
  const {
    runTurnDispatch,
    resolveRoutableSession,
    rememberSuccessfulTurnDispatch,
    persistStartedTurn,
  } = input;
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
      return yield* runTurnDispatch(input.threadId, (generation) =>
        Effect.gen(function* () {
          const routed = yield* resolveRoutableSession({
            threadId: input.threadId,
            operation: "ProviderService.sendTurn",
            allowRecovery: true,
          });
          const turn = yield* routed.adapter.sendTurn(input);
          const persistenceInput: StartedTurnPersistenceInput = {
            threadId: input.threadId,
            provider: routed.adapter.provider,
            turnId: String(turn.turnId),
            generation,
            ...(routed.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: routed.lifecycleGeneration }
              : {}),
            ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            lastRuntimeEvent: "provider.sendTurn",
          };
          rememberSuccessfulTurnDispatch(persistenceInput);

          yield* persistStartedTurn(persistenceInput);
          return turn;
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
      return yield* runTurnDispatch(input.threadId, (generation) =>
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
          const persistenceInput: StartedTurnPersistenceInput = {
            threadId: input.threadId,
            provider: routed.adapter.provider,
            turnId: String(turn.turnId),
            generation,
            ...(routed.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: routed.lifecycleGeneration }
              : {}),
            ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            lastRuntimeEvent: "provider.steerTurn",
          };
          rememberSuccessfulTurnDispatch(persistenceInput);
          yield* persistStartedTurn(persistenceInput);
          return turn;
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

      return yield* runTurnDispatch(input.threadId, (generation) =>
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
          const persistenceInput: StartedTurnPersistenceInput = {
            threadId: input.threadId,
            provider: routed.adapter.provider,
            turnId: String(turn.turnId),
            generation,
            ...(routed.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: routed.lifecycleGeneration }
              : {}),
            ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
            lastRuntimeEvent: "provider.startReview",
          };
          rememberSuccessfulTurnDispatch(persistenceInput);
          yield* persistStartedTurn(persistenceInput);
          return turn;
        }),
      );
    });

  const startClaudeCompaction: NonNullable<ProviderServiceShape["startClaudeCompaction"]> = (
    input,
  ) =>
    runTurnDispatch(input.threadId, (generation) =>
      Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.startClaudeCompaction",
          allowRecovery: true,
        });
        if (!routed.adapter.startClaudeCompaction) {
          return yield* toValidationError(
            "ProviderService.startClaudeCompaction",
            "Native Claude compaction is unavailable.",
          );
        }
        const turn = yield* routed.adapter.startClaudeCompaction(input);
        const persistenceInput: StartedTurnPersistenceInput = {
          threadId: input.threadId,
          provider: routed.adapter.provider,
          turnId: String(turn.turnId),
          generation,
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          lastRuntimeEvent: "provider.startClaudeCompaction",
        };
        rememberSuccessfulTurnDispatch(persistenceInput);
        yield* persistStartedTurn(persistenceInput);
        return turn;
      }),
    );
  return { sendTurn, steerTurn, startReview, startClaudeCompaction };
}
