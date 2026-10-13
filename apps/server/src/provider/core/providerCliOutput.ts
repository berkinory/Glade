import { asNonEmptyString } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { Option, Result, Schema } from "effect";
import { decodeJsonResult } from "../../platform/schemaJson";

export const PROVIDER_COMMAND_TIMEOUT_DETAIL = "Timed out while running command.";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const COMMAND_MISSING_MARKERS = ["enoent", "notfound", "command not found"] as const;

export function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return COMMAND_MISSING_MARKERS.some((marker) => lower.includes(marker));
}

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return PROVIDER_COMMAND_TIMEOUT_DETAIL;
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function extractAuthMethod(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthMethod(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authMethod", "auth_type", "authType"] as const) {
    if (typeof record[key] === "string") {
      const trimmed = record[key].trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthMethod(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

const SUBSCRIPTION_TYPE_KEYS = [
  "subscriptionType",
  "subscription_type",
  "plan",
  "tier",
  "planType",
  "plan_type",
] as const;

const SUBSCRIPTION_CONTAINER_KEYS = ["account", "subscription", "user", "billing"] as const;

function findSubscriptionType(value: unknown): Option.Option<string> {
  if (Array.isArray(value)) {
    return Option.firstSomeOf(value.map(findSubscriptionType));
  }
  return Option.fromNullishOr(asRecord(value)).pipe(
    Option.flatMap((record) => {
      const direct = Option.firstSomeOf(
        SUBSCRIPTION_TYPE_KEYS.map((key) => Option.fromNullishOr(asNonEmptyString(record[key]))),
      );
      if (Option.isSome(direct)) return direct;
      return Option.firstSomeOf(
        SUBSCRIPTION_CONTAINER_KEYS.map((key) =>
          Option.fromNullishOr(asRecord(record[key])).pipe(Option.flatMap(findSubscriptionType)),
        ),
      );
    }),
  );
}

export const decodeUnknownJson = decodeJsonResult(Schema.Unknown);

export function extractSubscriptionTypeFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim());
  if (Result.isFailure(parsed)) return undefined;
  return Option.getOrUndefined(findSubscriptionType(parsed.success));
}
