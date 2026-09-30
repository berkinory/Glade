import {
  type ClaudeSessionContext,
  type ClaudeSessionQuery,
  type ClaudeSessionUsageCache,
} from "./sessionTypes";
import { Effect, Option } from "effect";
import { decideClaudeContextUsageWarnings } from "../claudeTokenUsage.ts";
import { claudeEffectiveContextBudget } from "./modelCapabilities";
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { normalizeOperationError } from "../../../platform/operationError.ts";
import { toError } from "./streamErrors";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";

export const CLAUDE_CONTEXT_USAGE_TIMEOUT_MS = 1_000;

export function makeClaudeContextUsage(input: {
  readonly emitRuntimeWarning: ClaudeRuntimeEventsShape["emitRuntimeWarning"];
}) {
  const { emitRuntimeWarning } = input;
  const maybeEmitContextUsageWarning = (
    context: ClaudeSessionContext,
    rawUsage: Record<string, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const warnings = decideClaudeContextUsageWarnings(
        rawUsage,
        claudeEffectiveContextBudget(context),
        context.emittedContextUsageWarnings,
      );
      if (!warnings) {
        return;
      }

      context.emittedContextUsageWarnings.add(warnings.first.key);
      yield* emitRuntimeWarning(context, warnings.first.message);
      if (warnings.second) {
        context.emittedContextUsageWarnings.add(warnings.second.key);
        yield* emitRuntimeWarning(context, warnings.second.message);
      }
    });

  const readClaudeContextUsage = (
    context: Pick<ClaudeSessionQuery, "query"> &
      Pick<ClaudeSessionUsageCache, "contextUsageControlEnabled">,
  ): Effect.Effect<SDKControlGetContextUsageResponse | undefined> => {
    if (!context.contextUsageControlEnabled) {
      return Effect.succeed(undefined);
    }
    return Effect.tryPromise({
      try: () => context.query.getContextUsage({ detail: "summary" }),
      catch: (cause) =>
        normalizeOperationError(toError(cause, "Failed to read Claude context usage.")),
    }).pipe(
      Effect.timeoutOption(CLAUDE_CONTEXT_USAGE_TIMEOUT_MS),
      Effect.map(
        Option.match({
          onNone: () => {
            // A missing control response otherwise blocks every future turn.
            context.contextUsageControlEnabled = false;
            return undefined;
          },
          onSome: (usage) => usage,
        }),
      ),
      Effect.catch(() => Effect.succeed(undefined)),
    );
  };
  return { readClaudeContextUsage, maybeEmitContextUsageWarning };
}
