import { Cause, Effect, FileSystem } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

export const AUTH_JSON_BODY_MAX_BYTES = 16 * 1024;

function isBodyCapacityError(cause: unknown): boolean {
  if (Cause.isExceededCapacityError(cause)) return true;
  if (cause instanceof Error && cause.message === "maxBytes exceeded") return true;
  if (!cause || typeof cause !== "object") return false;
  const record = cause as { readonly reason?: unknown; readonly cause?: unknown };
  return (
    (record.cause !== undefined && record.cause !== cause && isBodyCapacityError(record.cause)) ||
    (record.reason !== undefined && isBodyCapacityError(record.reason))
  );
}

export function mapPayloadError(message: string, cause: unknown) {
  if (
    cause &&
    typeof cause === "object" &&
    "status" in cause &&
    (cause as { readonly status?: unknown }).status === 413
  ) {
    return cause as { readonly message: string; readonly status: 413; readonly cause?: unknown };
  }
  return { message, status: 400 as const, cause };
}

export const readEffectJson = (
  request: HttpServerRequest.HttpServerRequest,
  message: string,
): Effect.Effect<
  unknown,
  Error | { readonly message: string; readonly status: 413; readonly cause?: unknown }
> => {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > AUTH_JSON_BODY_MAX_BYTES) {
    return Effect.fail({
      message: "Request body too large.",
      status: 413 as const,
    });
  }
  return request.json.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(AUTH_JSON_BODY_MAX_BYTES)),
    Effect.mapError((cause) =>
      isBodyCapacityError(cause)
        ? { message: "Request body too large.", status: 413 as const, cause }
        : new (class extends Error {
            override readonly cause = cause;
          })(message),
    ),
  );
};

export const readEffectBinary = (
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
): Effect.Effect<
  Uint8Array,
  { readonly message: string; readonly status: number; readonly cause?: unknown }
> => {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return Effect.fail({ message: "Request body too large.", status: 413 as const });
  }
  return request.arrayBuffer.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(maxBytes)),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError((cause) => ({
      message: isBodyCapacityError(cause)
        ? "Request body too large."
        : "Could not read request body.",
      status: isBodyCapacityError(cause) ? 413 : 400,
      cause,
    })),
  );
};
