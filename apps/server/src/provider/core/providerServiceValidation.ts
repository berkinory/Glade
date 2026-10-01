import { type ProviderSession } from "@glade/contracts/provider/provider";
import {
  providerSupportsAutoRuntimeMode,
  unsupportedAutoRuntimeModeMessage,
} from "@glade/shared/threads/runtimeMode";
import { Effect, Schema, SchemaIssue } from "effect";
import { ProviderValidationError } from "./Errors.ts";
import { createHash } from "node:crypto";
import { ThreadId, NonNegativeInt, TrimmedNonEmptyString } from "@glade/contracts/core/baseSchemas";
import {
  ModelSelection,
  ProviderStartOptions,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";
import { PROVIDER_RUNTIME_QUARANTINE_CAUSE_MAX_BYTES } from "./providerServiceConfiguration";

export function validateAutoRuntimeMode(
  operation: string,
  provider: ProviderSession["provider"],
  runtimeMode: ProviderSession["runtimeMode"],
) {
  return runtimeMode !== "auto" || providerSupportsAutoRuntimeMode(provider)
    ? Effect.void
    : Effect.fail(
        new ProviderValidationError({
          operation,
          issue: unsupportedAutoRuntimeModeMessage(provider),
        }),
      );
}

export function summarizeProviderRuntimeQuarantineCause(cause: string): {
  readonly cause: string;
  readonly causeTruncated?: true;
  readonly causeOriginalBytes?: number;
  readonly causeSha256?: string;
} {
  const encoded = Buffer.from(cause, "utf8");
  if (encoded.byteLength <= PROVIDER_RUNTIME_QUARANTINE_CAUSE_MAX_BYTES) {
    return { cause };
  }
  let prefixEnd = PROVIDER_RUNTIME_QUARANTINE_CAUSE_MAX_BYTES;
  while (prefixEnd > 0 && ((encoded[prefixEnd] ?? 0) & 0xc0) === 0x80) {
    prefixEnd -= 1;
  }
  return {
    cause: encoded.subarray(0, prefixEnd).toString("utf8"),
    causeTruncated: true,
    causeOriginalBytes: encoded.byteLength,
    causeSha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

export const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

export const ClearSessionResumeCursorInput = Schema.Struct({
  threadId: ThreadId,
  preserveActiveRuntime: Schema.optional(Schema.Boolean),
});

export const CompletePriorTranscriptBootstrapInput = Schema.Struct({
  threadId: ThreadId,
});

export const ImportExternalThreadInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.Literals(["codex", "claudeAgent"]),
  externalThreadId: TrimmedNonEmptyString,
  sourceCwd: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: ModelSelection,
  providerOptions: Schema.optional(ProviderStartOptions),
  runtimeMode: RuntimeMode,
});

export function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );
