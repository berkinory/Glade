import { Data } from "effect";

export type TaggedFailure = Error & { readonly _tag: string };

class ExternalOperationError extends Data.TaggedError("ExternalOperationError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly code?: string;
}> {}

export function normalizeOperationError(cause: unknown): TaggedFailure {
  if (cause instanceof Error && "_tag" in cause && typeof cause._tag === "string")
    return cause as TaggedFailure;
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : undefined;
  return new ExternalOperationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    ...(code === undefined ? {} : { code }),
  });
}
