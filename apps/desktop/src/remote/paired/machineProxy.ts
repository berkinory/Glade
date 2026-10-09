import * as Crypto from "node:crypto";
import * as Http from "node:http";
import * as Https from "node:https";
import type { Socket } from "node:net";

interface MachineUpstream {
  readonly baseUrl: URL;
  readonly sessionToken: string;
}

export interface MachineProxy {
  // The address the renderer uses for this machine, with the proxy's own key as `token`, the same
  // form as an SSH host's tunnel address.
  readonly wsUrl: string;
  setUpstream(upstream: MachineUpstream | null): void;
  close(): Promise<void>;
}

// Never forwarded: the proxy speaks for the renderer with the machine's session token, so the
// renderer's own origin and cookies mean nothing to the other machine.
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "cookie",
  "authorization",
  "proxy-authorization",
]);

function forwardedHeaders(
  headers: Http.IncomingHttpHeaders,
  upstream: MachineUpstream,
): Http.OutgoingHttpHeaders {
  const result: Http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) result[name] = value;
  }
  result.host = upstream.baseUrl.host;
  result.authorization = `Bearer ${upstream.sessionToken}`;
  return result;
}

function corsHeaders(origin: string | undefined, allowedOrigins: ReadonlySet<string>) {
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

// Serves one paired machine on a loopback port. The renderer talks to it like any SSH tunnel; the
// proxy checks its own key, then forwards over HTTPS or the network with the machine's session token
// in the Authorization header, so the token never appears in a URL. `onUpstreamLost` reports an
// upstream that failed or refused the session, so the caller can find another route or report that
// the machine signed this app out.
export function createMachineProxy(input: {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly onUpstreamLost: () => void;
}): Promise<MachineProxy> {
  const key = Crypto.randomBytes(24).toString("hex");
  let upstream: MachineUpstream | null = null;
  const sockets = new Set<Socket>();

  const authorize = (request: Http.IncomingMessage): URL | null => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.get("token") !== key) return null;
    url.searchParams.delete("token");
    return url;
  };

  const upstreamRequest = (path: URL, request: Http.IncomingMessage, target: MachineUpstream) => {
    const url = new URL(`${path.pathname}${path.search}`, target.baseUrl);
    const client = url.protocol === "https:" ? Https : Http;
    return client.request(url, {
      method: request.method,
      headers: forwardedHeaders(request.headers, target),
    });
  };

  const server = Http.createServer((request, response) => {
    const cors = corsHeaders(request.headers.origin, input.allowedOrigins);
    const path = authorize(request);
    if (!path) {
      response.writeHead(403, cors).end();
      return;
    }
    if (request.method === "OPTIONS") {
      response
        .writeHead(204, {
          ...cors,
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": request.headers["access-control-request-headers"] ?? "",
          "access-control-max-age": "600",
        })
        .end();
      return;
    }
    const target = upstream;
    if (!target) {
      response.writeHead(503, cors).end();
      return;
    }
    const forward = upstreamRequest(path, request, target);
    forward.on("response", (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers, ...cors };
      delete headers["set-cookie"];
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    });
    forward.on("error", () => {
      input.onUpstreamLost();
      if (!response.headersSent) response.writeHead(502, cors);
      response.end();
    });
    request.pipe(forward);
  });

  server.on("upgrade", (request: Http.IncomingMessage, socket: Socket, head: Buffer) => {
    const path = authorize(request);
    const target = upstream;
    if (!path || !target) {
      socket.end(`HTTP/1.1 ${path ? "503 Service Unavailable" : "403 Forbidden"}\r\n\r\n`);
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const forward = upstreamRequest(path, request, target);
    forward.on("upgrade", (upstreamResponse, upstreamSocket: Socket, upstreamHead: Buffer) => {
      const lines = [`HTTP/1.1 101 ${upstreamResponse.statusMessage ?? "Switching Protocols"}`];
      for (let i = 0; i < upstreamResponse.rawHeaders.length; i += 2) {
        lines.push(`${upstreamResponse.rawHeaders[i]}: ${upstreamResponse.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.on("error", () => socket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    // A refused upgrade (an expired session, an incompatible server) passes through as is.
    forward.on("response", (upstreamResponse) => {
      if (upstreamResponse.statusCode === 401) input.onUpstreamLost();
      const lines = [`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}`];
      for (let i = 0; i < upstreamResponse.rawHeaders.length; i += 2) {
        lines.push(`${upstreamResponse.rawHeaders[i]}: ${upstreamResponse.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      upstreamResponse.pipe(socket);
    });
    forward.on("error", () => {
      input.onUpstreamLost();
      socket.destroy();
    });
    forward.end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        wsUrl: `ws://127.0.0.1:${port}/?token=${key}`,
        setUpstream: (next) => {
          upstream = next;
          // Live sockets belong to the previous route; the renderer reconnects through the new one.
          for (const socket of sockets) socket.destroy();
        },
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
