import { Cause } from "effect";
import type { SDKResultMessage, SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";
import { type RuntimeTurnState } from "@glade/contracts/provider/runtimeMetadata";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterSessionClosedError,
  type ProviderAdapterError,
  ProviderAdapterRequestError,
} from "../../core/Errors.ts";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";

export function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

export function toError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(toMessage(cause, fallback));
}

function normalizeClaudeStreamMessages(cause: Cause.Cause<Error>): ReadonlyArray<string> {
  const errors = Cause.prettyErrors(cause)
    .map((error) => error.message.trim())
    .filter((message) => message.length > 0);
  if (errors.length > 0) {
    return errors;
  }

  const squashed = toMessage(Cause.squash(cause), "").trim();
  return squashed.length > 0 ? [squashed] : [];
}

function isClaudeInterruptedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("all fibers interrupted without error") ||
    normalized.includes("request was aborted") ||
    normalized.includes("interrupted by user")
  );
}

export function isClaudeInterruptedCause(cause: Cause.Cause<Error>): boolean {
  return (
    Cause.hasInterruptsOnly(cause) ||
    normalizeClaudeStreamMessages(cause).some(isClaudeInterruptedMessage)
  );
}

export function messageFromClaudeStreamCause(cause: Cause.Cause<Error>, fallback: string): string {
  return normalizeClaudeStreamMessages(cause)[0] ?? fallback;
}

export function interruptionMessageFromClaudeCause(cause: Cause.Cause<Error>): string {
  const message = messageFromClaudeStreamCause(cause, "Claude runtime interrupted.");
  return isClaudeInterruptedMessage(message) ? "Claude runtime interrupted." : message;
}

const CLAUDE_BENIGN_TERMINATION_EXIT_CODES = new Set([130, 143]);

export const CLAUDE_BENIGN_TERMINATION_MESSAGE =
  "Claude runtime stopped and will resume on your next message.";

function isClaudeBenignTerminationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const exitCode = normalized.match(/exited with code (\d+)/)?.[1];
  if (exitCode !== undefined) {
    return CLAUDE_BENIGN_TERMINATION_EXIT_CODES.has(Number.parseInt(exitCode, 10));
  }
  return normalized.includes("signal sigterm") || normalized.includes("signal sigint");
}

export function isClaudeBenignTerminationCause(cause: Cause.Cause<Error>): boolean {
  return normalizeClaudeStreamMessages(cause).some(isClaudeBenignTerminationMessage);
}

export function isClaudeMissingResumeConversationCause(cause: Cause.Cause<Error>): boolean {
  return normalizeClaudeStreamMessages(cause).some((message) =>
    message.toLowerCase().includes("no conversation found with session id"),
  );
}

export function resultErrorsText(result: SDKResultMessage): string {
  return "errors" in result && Array.isArray(result.errors)
    ? result.errors.join(" ").toLowerCase()
    : "";
}

export function isInterruptedResult(result: SDKResultMessage): boolean {
  const errors = resultErrorsText(result);
  if (errors.includes("interrupt")) {
    return true;
  }

  return (
    result.subtype === "error_during_execution" &&
    result.is_error === false &&
    (errors.includes("request was aborted") ||
      errors.includes("interrupted by user") ||
      errors.includes("aborted"))
  );
}

export function hasPendingUserInterrupt(context: ClaudeSessionContext): boolean {
  const activeTurnId = context.turnState?.turnId;
  return activeTurnId !== undefined && context.interruptRequestedTurnId === activeTurnId;
}

export function sanitizeClaudeDisplayText(text: string): string {
  if (text.length === 0) {
    return text;
  }

  const lines = text.split(/\r?\n/);
  const filteredLines = lines.filter((line) => {
    const normalized = line.trim().toLowerCase();
    return !(
      normalized.startsWith("[ede_diagnostic]") &&
      normalized.includes("result_type=") &&
      normalized.includes("stop_reason=")
    );
  });

  if (
    filteredLines.length === 0 &&
    lines.some((line) => line.trim().toLowerCase().startsWith("[ede_diagnostic]"))
  ) {
    return "";
  }

  return filteredLines.join("\n");
}

export function normalizeClaudeUserVisibleErrorMessage(
  text: string | undefined,
  status: RuntimeTurnState,
): string | undefined {
  if (typeof text !== "string") {
    return undefined;
  }

  const sanitized = sanitizeClaudeDisplayText(text).trim();
  if (sanitized.length === 0) {
    return undefined;
  }

  if (sanitized === "User interrupted response.") {
    return status === "interrupted" ? "Claude runtime interrupted." : undefined;
  }

  if (/^[\]})"'`.,;:!?_-]+$/.test(sanitized)) {
    return status === "interrupted" ? "Claude runtime interrupted." : "Claude turn failed.";
  }

  return sanitized;
}

export function claudeAssistantErrorMessage(error: SDKAssistantMessageError): string {
  switch (error) {
    case "authentication_failed":
      return "Claude is not authenticated. Run `claude auth login --claudeai`, then retry.";
    case "oauth_org_not_allowed":
      return "Claude authentication succeeded, but this organization does not allow Claude Code.";
    case "account_on_hold":
      return "The active Claude account is on hold. Resolve the account issue, then retry.";
    case "billing_error":
      return "Claude billing or subscription access failed. Check the active Claude account, then retry.";
    case "rate_limit":
      return "Claude rate limit reached. Wait briefly, then retry.";
    case "overloaded":
      return "Claude is temporarily overloaded. Retry in a moment.";
    case "invalid_request":
      return "Claude rejected the request as invalid.";
    case "model_not_found":
      return "The selected Claude model is unavailable for this account.";
    case "server_error":
      return "Claude returned a server error. Retry in a moment.";
    case "max_output_tokens":
      return "Claude reached the maximum output length before completing the turn.";
    case "unknown":
      return "Claude failed to complete the turn.";
  }
}

export function claudeAssistantErrorRequiresProcessRestart(
  error: SDKAssistantMessageError,
): boolean {
  return (
    error === "authentication_failed" ||
    error === "oauth_org_not_allowed" ||
    error === "account_on_hold" ||
    error === "billing_error"
  );
}

function toSessionError(
  threadId: ThreadId,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();
  if (normalized.includes("unknown session") || normalized.includes("not found")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  if (normalized.includes("closed")) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

export function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: toMessage(cause, `${method} failed`),
    cause,
  });
}
