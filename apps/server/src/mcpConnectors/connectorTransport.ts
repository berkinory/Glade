import {
  OutboundHttpError,
  outboundHttp,
  type OutboundHttpStreamResponse,
} from "../platform/outboundHttp/outboundHttp.ts";
import type { OAuthChallenge } from "./connectorOAuth.ts";

// Advertised by the probe; servers negotiate down when they need to.
const PROBE_PROTOCOL_VERSION = "2025-06-18";
const PROBE_MAX_RESPONSE_BYTES = 1024 * 1024;

export type UpstreamMethod = "GET" | "POST" | "DELETE";

export interface UpstreamRequest {
  readonly method: UpstreamMethod;
  // Re-serialized JSON-RPC message or batch, for POST.
  readonly body?: string;
  readonly accept: string | undefined;
  readonly sessionId: string | undefined;
  readonly protocolVersion: string | undefined;
  readonly lastEventId: string | undefined;
}

// GET opens a long-lived notification stream. It gets its own, smaller admission gate so open
// streams never queue tool calls to the same vendor.
function upstreamPolicy(url: string, method: UpstreamMethod) {
  const origin = new URL(url).origin;
  const stream = method === "GET";
  return {
    service: `${stream ? "mcp-connector-stream" : "mcp-connector"}:${origin}`,
    allowedOrigins: [origin],
    timeoutMs: stream ? 10 * 60_000 : 5 * 60_000,
    maxRequestBytes: 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    maxRedirects: 0,
    maxConcurrent: stream ? 4 : 8,
    maxQueued: stream ? 4 : 64,
    requirePublicAddress: true,
  };
}

export function openUpstream(
  url: string,
  request: UpstreamRequest,
  bearerToken: string | undefined,
  signal?: AbortSignal,
): Promise<OutboundHttpStreamResponse> {
  const headers = new Headers({
    accept:
      request.accept ??
      (request.method === "GET" ? "text/event-stream" : "application/json, text/event-stream"),
  });
  if (request.body !== undefined) headers.set("content-type", "application/json");
  if (request.sessionId) headers.set("mcp-session-id", request.sessionId);
  if (request.protocolVersion) headers.set("mcp-protocol-version", request.protocolVersion);
  if (request.lastEventId) headers.set("last-event-id", request.lastEventId);
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
  return outboundHttp.stream({
    policy: upstreamPolicy(url, request.method),
    url,
    method: request.method,
    headers,
    ...(request.body !== undefined ? { body: request.body } : {}),
    ...(signal ? { signal } : {}),
  });
}

export function describeUpstreamFailure(cause: unknown, name: string): string {
  if (cause instanceof OutboundHttpError) {
    if (cause.code === "timeout") return `${name} did not answer in time.`;
    if (cause.code === "response-too-large")
      return `${name} sent a response larger than Glade accepts.`;
    if (cause.code === "admission") return `Too many requests to ${name} are already running.`;
  }
  return `Glade could not reach ${name}.`;
}

function challengeParameter(header: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`, "u").exec(header);
  return match?.[1] || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBounded(body: ReadableStream<Uint8Array>, stop: (text: string) => boolean) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length <= PROBE_MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (stop(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

// The `data:` payloads of complete SSE events in `text`.
function sseEventPayloads(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, "\n");
  const events = normalized.split("\n\n");
  // The last chunk is an incomplete event unless the text ended on a blank line.
  if (!normalized.endsWith("\n\n")) events.pop();
  return events.flatMap((event) => {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n");
    return data.trim() ? [data] : [];
  });
}

function initializeAnswer(text: string, eventStream: boolean): unknown {
  const candidates = eventStream ? sseEventPayloads(text) : [text];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && parsed.id === 0) return parsed;
    } catch {
      // Not JSON; a website or login page answering at the URL.
    }
  }
  return undefined;
}

function isInitializeResult(answer: unknown): boolean {
  if (!isRecord(answer) || answer.jsonrpc !== "2.0" || "error" in answer) return false;
  const result = answer.result;
  return (
    isRecord(result) &&
    typeof result.protocolVersion === "string" &&
    isRecord(result.capabilities) &&
    isRecord(result.serverInfo)
  );
}

export type ConnectorProbeResult =
  | { readonly kind: "open" }
  | { readonly kind: "oauth"; readonly challenge: OAuthChallenge }
  | { readonly kind: "unavailable"; readonly message: string };

// Sends `initialize` to learn whether the server answers as is, with `token`, or wants OAuth. A
// website, login page, or JSON-RPC error must never be saved as a connected MCP server.
export async function probeConnector(input: {
  readonly url: string;
  readonly name: string;
  readonly clientVersion: string;
  readonly token: string | undefined;
}): Promise<ConnectorProbeResult> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: PROBE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "Glade", version: input.clientVersion },
    },
  });
  let response: OutboundHttpStreamResponse;
  try {
    response = await outboundHttp.stream({
      policy: {
        ...upstreamPolicy(input.url, "POST"),
        service: "mcp-connector-probe",
        timeoutMs: 20_000,
        maxResponseBytes: PROBE_MAX_RESPONSE_BYTES,
      },
      url: input.url,
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      body,
    });
  } catch (cause) {
    return { kind: "unavailable", message: describeUpstreamFailure(cause, input.name) };
  }
  const eventStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  if (response.status < 200 || response.status >= 300) {
    await response.body.cancel().catch(() => undefined);
    if (response.status === 401 && input.token) {
      return { kind: "unavailable", message: `${input.name} rejected the token.` };
    }
    if (response.status === 401) {
      const challenge = response.headers.get("www-authenticate") ?? "";
      return {
        kind: "oauth",
        challenge: {
          resourceMetadataUrl: challengeParameter(challenge, "resource_metadata"),
          scope: challengeParameter(challenge, "scope"),
        },
      };
    }
    if (response.status === 403) {
      return { kind: "unavailable", message: `${input.name} refused the connection.` };
    }
    if (response.status === 404 || response.status === 405) {
      return { kind: "unavailable", message: "No MCP server answered at this URL." };
    }
    return { kind: "unavailable", message: `${input.name} answered with HTTP ${response.status}.` };
  }
  let text: string;
  try {
    text = await readBounded(
      response.body,
      (sofar) => eventStream && initializeAnswer(sofar, true) !== undefined,
    );
  } catch (cause) {
    return { kind: "unavailable", message: describeUpstreamFailure(cause, input.name) };
  }
  // Close the session the probe opened, if the server keeps one.
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) {
    void openUpstream(
      input.url,
      {
        method: "DELETE",
        accept: undefined,
        sessionId,
        protocolVersion: undefined,
        lastEventId: undefined,
      },
      input.token,
    )
      .then((closed) => closed.body.cancel())
      .catch(() => undefined);
  }
  return isInitializeResult(initializeAnswer(text, eventStream))
    ? { kind: "open" }
    : {
        kind: "unavailable",
        message: `${input.name} did not answer like an MCP server.`,
      };
}
