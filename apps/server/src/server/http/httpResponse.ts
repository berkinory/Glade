import { HttpServerResponse, HttpServerRequest } from "effect/unstable/http";
import { type ServerConfigShape } from "../config";
import { normalizeCorsOrigin, isTrustedAppOrigin } from "./trustedOrigins";
import { FileSystem } from "effect";
import Mime from "@effect/platform-node/Mime";

export const SVG_DOCUMENT_SECURITY_HEADERS = {
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface HttpPayload {
  readonly statusCode: number;
  readonly contentType: string;
  readonly headers?: Record<string, string>;
  readonly body: string | Uint8Array;
}

export function toEffectHttpResponse(payload: HttpPayload) {
  if (typeof payload.body === "string") {
    return HttpServerResponse.text(payload.body, {
      status: payload.statusCode,
      contentType: payload.contentType,
      ...(payload.headers ? { headers: payload.headers } : {}),
    });
  }

  return HttpServerResponse.uint8Array(payload.body, {
    status: payload.statusCode,
    contentType: payload.contentType,
    ...(payload.headers ? { headers: payload.headers } : {}),
  });
}

export function localPreviewCorsHeaders(input: {
  readonly config: ServerConfigShape;
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly url: URL;
}): Record<string, string> {
  const origin = normalizeCorsOrigin(input.request.headers.origin);
  if (
    !origin ||
    !isTrustedAppOrigin({ origin, requestOrigin: input.url.origin, config: input.config })
  ) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export function streamedFileResponse(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: string;
  readonly sizeBytes: number;
  readonly headers: Record<string, string>;
}): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.stream(input.fileSystem.stream(input.path), {
    status: 200,
    contentType: Mime.getType(input.path) ?? "application/octet-stream",
    contentLength: input.sizeBytes,
    headers: input.headers,
  });
}
