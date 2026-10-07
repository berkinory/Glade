import {
  GladeCreateThreadsInput,
  GladeWaitForThreadsInput,
} from "@glade/contracts/provider/agentGateway";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Schema } from "effect";

export const PROVIDER_KINDS: ReadonlyArray<ProviderKind> = ["codex", "claudeAgent"];

export class ToolInputError extends Error {
  readonly _tag = "ToolInputError";
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function readStringArg(
  args: Record<string, unknown>,
  name: string,
  options?: { readonly required?: boolean },
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    if (options?.required) throw new ToolInputError(`Missing required argument "${name}".`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`Argument "${name}" must be a non-empty string.`);
  }
  return value.trim();
}

export function readNumberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolInputError(`Argument "${name}" must be a number.`);
  }
  return value;
}

export function readBooleanArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Argument "${name}" must be a boolean.`);
  }
  return value;
}

export function readStringArrayArg(
  args: Record<string, unknown>,
  name: string,
): ReadonlyArray<string> | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new ToolInputError(`Argument "${name}" must be an array of non-empty strings.`);
  }
  return value.map((entry) => (entry as string).trim());
}

export function decodeCreateThreadsInput(value: unknown) {
  try {
    return Schema.decodeUnknownSync(GladeCreateThreadsInput)(value);
  } catch (error) {
    throw new ToolInputError(`Invalid Glade creation plan: ${errorText(error)}`);
  }
}

export function decodeWaitForThreadsInput(value: unknown) {
  try {
    return Schema.decodeUnknownSync(GladeWaitForThreadsInput)(value);
  } catch (error) {
    throw new ToolInputError(`Invalid Glade wait request: ${errorText(error)}`);
  }
}
