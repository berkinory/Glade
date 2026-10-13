import { type ProviderIntentEvent } from "../providerIntentClassification.ts";
import { Cause, Option, Schema } from "effect";
import { ProviderServiceError, ProviderAdapterRequestError } from "../../provider/core/Errors.ts";

export type InteractionResponseEvent = Extract<
  ProviderIntentEvent,
  {
    type: "thread.approval-response-requested" | "thread.user-input-response-requested";
  }
>;

export function isUnavailableInteractionRuntime(cause: Cause.Cause<ProviderServiceError>): boolean {
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => false,
    onSome: (error) =>
      (error._tag === "ProviderValidationError" && error.reason !== undefined) ||
      error._tag === "ProviderAdapterSessionNotFoundError" ||
      error._tag === "ProviderAdapterSessionClosedError",
  });
}

export function isUnknownPendingApprovalRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

export function isUnknownPendingUserInputRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

export function interactionFailureSettlementStatus(
  cause: Cause.Cause<ProviderServiceError>,
  isUnknownPendingRequest: boolean,
): "retryable" | "uncertain" {
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => "uncertain" as const,
    onSome: (error) => {
      if (
        error._tag === "ProviderAdapterRequestError" &&
        error.method === "permission.reply.acknowledge"
      ) {
        return "retryable" as const;
      }
      return isUnknownPendingRequest ||
        error._tag === "ProviderAdapterRequestError" ||
        error._tag === "ProviderAdapterProcessError"
        ? ("uncertain" as const)
        : ("retryable" as const);
    },
  });
}

export function isStaleResumeError(error: unknown): boolean {
  return Schema.is(ProviderAdapterRequestError)(error) && error.reason === "stale-resume";
}

export function isRollbackStillInProgressError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("rollback") || normalized.includes("revert")) &&
    (normalized.includes("turn is in progress") ||
      normalized.includes("turn in progress") ||
      normalized.includes("active turn"))
  );
}
