import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "../core/baseSchemas";

export const ProviderFailureKind = Schema.Literals([
  "auth_required",
  "access_denied",
  "quota_exhausted",
  "rate_limited",
  "overloaded",
  "context_exhausted",
  "model_unavailable",
  "bad_request",
  "connection_lost",
  "protocol_error",
  "internal",
]);
export type ProviderFailureKind = typeof ProviderFailureKind.Type;

export const ProviderFailureRetry = Schema.Union([
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({
    state: Schema.Literal("retrying"),
    attempt: Schema.optional(PositiveInt),
    maxAttempts: Schema.optional(PositiveInt),
    retryDelayMs: Schema.optional(NonNegativeInt),
  }),
]);
export type ProviderFailureRetry = typeof ProviderFailureRetry.Type;

export const ProviderFailure = Schema.Struct({
  kind: ProviderFailureKind,
  retry: ProviderFailureRetry,
  action: Schema.NullOr(
    Schema.Literals(["login", "retry", "wait", "compact", "new_session", "choose_model"]),
  ),
  resetsAt: Schema.NullOr(IsoDateTime),
  httpStatus: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(100)).check(Schema.isLessThanOrEqualTo(599)),
  ),
  message: TrimmedNonEmptyString,
});
export type ProviderFailure = typeof ProviderFailure.Type;
