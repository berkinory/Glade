import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AGENT_GATEWAY_CONNECTORS_PATH } from "../agentGateway/connectorGrants.ts";
import { readMcpJsonBody } from "../agentGateway/httpRoute.ts";
import { AgentGatewayCredentials } from "../agentGateway/Services/AgentGatewayCredentials.ts";
import { extractBearerToken } from "../agentGateway/bearerToken.ts";
import { isRemoteRequest } from "../remoteAccess/remoteRequests.ts";
import type { UpstreamMethod, UpstreamRequest } from "./connectorTransport.ts";
import { MCP_CONNECTOR_OAUTH_CALLBACK_PATH } from "./Layers/McpConnectors.ts";
import { McpConnectors, type McpConnectorCallbackOutcome } from "./Services/McpConnectors.ts";

const CONNECTOR_ROUTE = `${AGENT_GATEWAY_CONNECTORS_PATH}/:connectorId`;

const notFound = () => HttpServerResponse.text("Not Found", { status: 404 });

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function callbackPage(outcome: McpConnectorCallbackOutcome): string {
  const title = outcome.ok ? `${outcome.name} is connected` : outcome.title;
  const message = outcome.ok
    ? "New chats can use it. You can close this tab and return to Glade."
    : `${outcome.message} You can close this tab.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Glade</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas; color: CanvasText; }
main { max-width: 420px; padding: 32px; text-align: center; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
p { margin: 0; opacity: 0.7; line-height: 1.5; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}

const callbackRoute = HttpRouter.add(
  "GET",
  MCP_CONNECTOR_OAUTH_CALLBACK_PATH,
  Effect.gen(function* () {
    const connectors = yield* McpConnectors;
    const request = yield* HttpServerRequest.HttpServerRequest;
    // The vendor redirects this machine's browser here; other devices have no business with it.
    if (isRemoteRequest(request)) return notFound();
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const param = (name: string) => url.searchParams.get(name) ?? undefined;
    const outcome = yield* connectors.completeSignIn({
      state: param("state"),
      code: param("code"),
      error: param("error"),
      errorDescription: param("error_description"),
    });
    return HttpServerResponse.text(callbackPage(outcome), {
      status: outcome.ok ? 200 : 400,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Referrer-Policy": "no-referrer",
      },
    });
  }),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One JSON-RPC error per request in the body, so the model reads the reason. Notifications expect
// no answer, so a body of only notifications is acknowledged.
function failureResponse(body: unknown, message: string) {
  const messages = Array.isArray(body) ? body : [body];
  const errors = messages.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.method === "string" &&
    entry.id !== undefined &&
    entry.id !== null
      ? [{ jsonrpc: "2.0", id: entry.id, error: { code: -32001, message } }]
      : [],
  );
  if (errors.length === 0) return HttpServerResponse.empty({ status: 202 });
  return HttpServerResponse.jsonUnsafe(Array.isArray(body) ? errors : errors[0]);
}

function unauthorized() {
  return HttpServerResponse.jsonUnsafe(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message:
          "caller_session_inactive: Missing, revoked, or invalid provider-session credential.",
      },
    },
    { status: 401 },
  );
}

const forwardRequest = (method: UpstreamMethod) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credentials = yield* AgentGatewayCredentials;
    const connectors = yield* McpConnectors;
    const token = extractBearerToken(request.headers.authorization);
    if (!token || credentials.verifySession(token) === null) return unauthorized();
    const { connectorId } = yield* HttpRouter.params;
    // A live bearer reaches only the connectors its session was given.
    if (!connectorId || credentials.connectorGrants?.canUse(token, connectorId) !== true) {
      return notFound();
    }

    let body: unknown;
    if (method === "POST") {
      const read = yield* readMcpJsonBody(request);
      if (read.kind === "too-large") {
        return HttpServerResponse.jsonUnsafe(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Request body exceeds the 1 MiB limit." },
          },
          { status: 413 },
        );
      }
      if (read.kind === "invalid") {
        return HttpServerResponse.jsonUnsafe(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON body." } },
          { status: 400 },
        );
      }
      body = read.body;
    }
    const upstream: UpstreamRequest = {
      method,
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      accept: request.headers.accept,
      sessionId: request.headers["mcp-session-id"],
      protocolVersion: request.headers["mcp-protocol-version"],
      lastEventId: request.headers["last-event-id"],
    };
    const result = yield* connectors.forward(connectorId, upstream);
    if (result.kind === "failure") {
      if (method === "POST") return failureResponse(body, result.message);
      return HttpServerResponse.text(result.message, { status: 502 });
    }
    const headers = result.sessionId ? { "Mcp-Session-Id": result.sessionId } : undefined;
    if (result.status === 202 || result.status === 204) {
      yield* Effect.promise(() => result.body.cancel().catch(() => undefined));
      return HttpServerResponse.empty({ status: result.status, ...(headers ? { headers } : {}) });
    }
    // Streamed through as it arrives, so progress notifications and server requests inside an SSE
    // answer reach the provider while a tool call runs.
    return HttpServerResponse.stream(
      Stream.fromReadableStream({ evaluate: () => result.body, onError: (cause) => cause }),
      {
        status: result.status,
        ...(result.contentType ? { contentType: result.contentType } : {}),
        headers: { "Cache-Control": "no-store", ...headers },
      },
    );
  });

export const mcpConnectorsRouteLayer = Layer.mergeAll(
  callbackRoute,
  HttpRouter.add("POST", CONNECTOR_ROUTE, forwardRequest("POST")),
  HttpRouter.add("GET", CONNECTOR_ROUTE, forwardRequest("GET")),
  HttpRouter.add("DELETE", CONNECTOR_ROUTE, forwardRequest("DELETE")),
);
