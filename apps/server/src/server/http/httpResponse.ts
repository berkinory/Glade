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

function parseByteRange(
  header: string | undefined,
  sizeBytes: number,
): { readonly start: number; readonly end: number } | "unsatisfiable" | null {
  // Multi-range and malformed headers fall back to a full 200 response, as RFC 9110 allows.
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (suffixLength === 0 || sizeBytes === 0) return "unsatisfiable";
    return { start: Math.max(0, sizeBytes - suffixLength), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  if (start >= sizeBytes) return "unsatisfiable";
  const end = match[2] === "" ? sizeBytes - 1 : Math.min(Number(match[2]), sizeBytes - 1);
  return end < start ? null : { start, end };
}

export function streamedFileResponse(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: string;
  readonly sizeBytes: number;
  readonly headers: Record<string, string>;
  readonly range: string | undefined;
}): HttpServerResponse.HttpServerResponse {
  const contentType = Mime.getType(input.path) ?? "application/octet-stream";
  const headers = { ...input.headers, "Accept-Ranges": "bytes" };
  const range = parseByteRange(input.range, input.sizeBytes);
  if (range === "unsatisfiable") {
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${input.sizeBytes}` },
    });
  }
  if (range === null) {
    return HttpServerResponse.stream(input.fileSystem.stream(input.path), {
      status: 200,
      contentType,
      contentLength: input.sizeBytes,
      headers,
    });
  }
  const length = range.end - range.start + 1;
  return HttpServerResponse.stream(
    input.fileSystem.stream(input.path, { offset: range.start, bytesToRead: length }),
    {
      status: 206,
      contentType,
      contentLength: length,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${input.sizeBytes}`,
      },
    },
  );
}
