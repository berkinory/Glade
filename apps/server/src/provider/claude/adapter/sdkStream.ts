import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeTurnCompletion } from "./turnCompletion";
import { makeClaudeToolTracking } from "./toolTracking";
import { makeClaudeTaskPresentation } from "./taskPresentation";
import { ClaudeSessionContext } from "./sessionTypes";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Stream, Exit, Cause } from "effect";
import { ProviderAdapterProcessError } from "../../core/Errors.ts";
import { type RuntimeTurnState } from "@glade/contracts/provider/runtimeMetadata";
import {
  hasPendingUserInterrupt,
  normalizeClaudeUserVisibleErrorMessage,
  claudeAssistantErrorRequiresProcessRestart,
  toError,
  isClaudeInterruptedCause,
  interruptionMessageFromClaudeCause,
  isClaudeBenignTerminationCause,
  messageFromClaudeStreamCause,
  CLAUDE_BENIGN_TERMINATION_MESSAGE,
  isClaudeMissingResumeConversationCause,
} from "./streamErrors";
import { turnStatusFromResult } from "./messageContent";
import { recognizedSubagentParentToolUseId } from "./sdkMetadata";
import { makeClaudeSessionTeardown } from "./sessionTeardown";
import { makeClaudeContentMessages } from "./contentMessages";
import { makeClaudeSystemMessages } from "./systemMessages";
import { claudeAssistantFailure } from "./failures.ts";

export function makeClaudeSdkStream(input: {
  readonly emitRuntimeError: ClaudeRuntimeEventsShape["emitRuntimeError"];
  readonly completeTurn: ReturnType<typeof makeClaudeTurnCompletion>["completeTurn"];
  readonly stopSessionInternal: ReturnType<typeof makeClaudeSessionTeardown>["stopSessionInternal"];
  readonly logNativeSdkMessage: ClaudeRuntimeEventsShape["logNativeSdkMessage"];
  readonly ensureSubagentRun: ReturnType<typeof makeClaudeToolTracking>["ensureSubagentRun"];
  readonly ensureSyntheticTurn: ReturnType<typeof makeClaudeToolTracking>["ensureSyntheticTurn"];
  readonly handleStreamEvent: ReturnType<typeof makeClaudeContentMessages>["handleStreamEvent"];
  readonly handleUserMessage: ReturnType<typeof makeClaudeContentMessages>["handleUserMessage"];
  readonly handleAssistantMessage: ReturnType<
    typeof makeClaudeContentMessages
  >["handleAssistantMessage"];
  readonly handleSdkTelemetryMessage: ReturnType<
    typeof makeClaudeSystemMessages
  >["handleSdkTelemetryMessage"];
  readonly ensureThreadId: ClaudeRuntimeEventsShape["ensureThreadId"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
  readonly handleSystemMessage: ReturnType<typeof makeClaudeSystemMessages>["handleSystemMessage"];
  readonly warnUnhandledSdkKind: ClaudeRuntimeEventsShape["warnUnhandledSdkKind"];
  readonly emitTrackedTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTrackedTasksUpdated"];
}) {
  const {
    emitRuntimeError,
    completeTurn,
    stopSessionInternal,
    logNativeSdkMessage,
    ensureSubagentRun,
    ensureSyntheticTurn,
    handleStreamEvent,
    handleUserMessage,
    handleAssistantMessage,
    handleSdkTelemetryMessage,
    ensureThreadId,
    updateResumeCursor,
    handleSystemMessage,
    warnUnhandledSdkKind,
    emitTrackedTasksUpdated,
  } = input;
  const handleResultMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Effect.gen(function* () {
      if (message.type !== "result") {
        return;
      }
      if (message.uuid && context.lastResultUuid === message.uuid) return;
      context.lastResultUuid = message.uuid;
      if (message.fast_mode_state !== undefined) {
        context.fastModeState = message.fast_mode_state;
      }

      const assistantError = context.turnState?.assistantError;
      let status: RuntimeTurnState;
      if (hasPendingUserInterrupt(context) && message.subtype === "error_during_execution") {
        status = "interrupted";
      } else if (assistantError) {
        status = "failed";
      } else {
        status = turnStatusFromResult(message);
      }

      let errorMessage: string | undefined;
      if (assistantError) {
        errorMessage = assistantError.message;
      } else if (message.subtype !== "success") {
        errorMessage = normalizeClaudeUserVisibleErrorMessage(message.errors[0], status);
      }

      if (status === "failed") {
        yield* emitRuntimeError(
          context,
          errorMessage ?? "Claude turn failed.",
          undefined,
          assistantError ? claudeAssistantFailure(assistantError.code) : undefined,
        );
      }

      yield* completeTurn(context, status, errorMessage, message);

      // An auth/account failure cannot be recovered by reusing that query after the user logs in, so
      // retire it after publishing the failed turn.
      if (assistantError && claudeAssistantErrorRequiresProcessRestart(assistantError.code)) {
        yield* stopSessionInternal(context, {
          emitExitEvent: true,
          interruptStream: false,
        });
      }
    });

  const handleSdkMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Effect.gen(function* () {
      yield* logNativeSdkMessage(context, message);

      const subagentToolUseId = recognizedSubagentParentToolUseId(context, message);
      if (subagentToolUseId !== undefined) {
        if (context.settledSubagentToolUseIds.has(subagentToolUseId)) {
          return;
        }
        const run = ensureSubagentRun(context, subagentToolUseId);
        yield* ensureSyntheticTurn(run.context);
        switch (message.type) {
          case "stream_event":
            yield* handleStreamEvent(run.context, message);
            return;
          case "user":
            yield* handleUserMessage(run.context, message);
            return;
          case "assistant":
            yield* handleAssistantMessage(run.context, message);
            return;
          default:
            yield* handleSdkTelemetryMessage(run.context, message);
            return;
        }
      }

      yield* ensureThreadId(context, message);

      switch (message.type) {
        case "stream_event":
          yield* handleStreamEvent(context, message);
          return;
        case "user":
          yield* handleUserMessage(context, message);
          return;
        case "assistant":
          yield* handleAssistantMessage(context, message);
          return;
        case "conversation_reset":
          delete context.resultUsageBaseline;
          context.requestUsage.reset();
          context.compactionMessageId = undefined;
          context.processedTokenTurnBaseline = context.processedTokenTotal;
          context.processedTokenResultBaseline = context.processedTokenTotal;
          yield* updateResumeCursor(context);
          return;
        case "result":
          yield* handleResultMessage(context, message);
          return;
        case "system":
          yield* handleSystemMessage(context, message);
          return;
        case "tool_progress":
        case "tool_use_summary":
        case "auth_status":
        case "rate_limit_event":
          yield* handleSdkTelemetryMessage(context, message);
          return;
        default:
          yield* warnUnhandledSdkKind(
            context,
            `type:${message.type}`,
            `Unhandled Claude SDK message type '${message.type}'.`,
            message,
          );
          return;
      }
    });

  const runSdkStream = (context: ClaudeSessionContext): Effect.Effect<void, Error> =>
    Stream.fromAsyncIterable(context.messageStream ?? context.query, (cause) =>
      toError(cause, "Claude runtime stream failed."),
    ).pipe(
      Stream.takeWhile(() => !context.stopped),
      Stream.runForEach((message) => handleSdkMessage(context, message)),
    );

  const handleStreamExit = (
    context: ClaudeSessionContext,
    exit: Exit.Exit<void, Error>,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Effect.gen(function* () {
      if (context.stopped) {
        return;
      }

      if (Exit.isFailure(exit)) {
        if (hasPendingUserInterrupt(context) || isClaudeInterruptedCause(exit.cause)) {
          if (context.turnState) {
            yield* completeTurn(
              context,
              "interrupted",
              interruptionMessageFromClaudeCause(exit.cause),
            );
          }
        } else if (isClaudeBenignTerminationCause(exit.cause)) {
          // Suspend the turn without an error toast so the session resumes on the next message.
          yield* Effect.logInfo("claude.session.benign_termination", {
            threadId: context.session.threadId,
            hadActiveTurn: context.turnState !== undefined,
            detail: messageFromClaudeStreamCause(exit.cause, "Claude runtime terminated."),
          });
          if (context.turnState) {
            yield* completeTurn(context, "interrupted", CLAUDE_BENIGN_TERMINATION_MESSAGE);
          }
        } else {
          const message = messageFromClaudeStreamCause(exit.cause, "Claude runtime stream failed.");
          if (isClaudeMissingResumeConversationCause(exit.cause)) {
            // Drop the dead native ids before completing the turn so ProviderService persists a cursor without
            // `resume`; the next dispatch then starts a fresh Claude session and bootstraps Glade's retained
            // transcript instead of replaying the same broken id forever.
            context.resumeSessionId = undefined;
            context.lastAssistantUuid = undefined;

            if (context.trackedTasks.size > 0) {
              context.trackedTasks.clear();
              yield* emitTrackedTasksUpdated(context, {
                rawPayload: { source: "claude.stale-resume-invalidated" },
              });
            }
            yield* Effect.logWarning("claude.session.stale_resume_invalidated", {
              threadId: context.session.threadId,
              detail: message,
            });
          }
          yield* emitRuntimeError(context, message, Cause.pretty(exit.cause));
          yield* completeTurn(context, "failed", message);
        }
      } else if (context.turnState) {
        yield* completeTurn(context, "interrupted", "Claude runtime stream ended.");
      }

      yield* stopSessionInternal(context, {
        emitExitEvent: true,
      });
    });
  return { runSdkStream, handleStreamExit };
}
