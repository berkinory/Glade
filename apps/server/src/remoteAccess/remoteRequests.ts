import type { Socket } from "node:net";

import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { VISUAL_REPLY_ROUTE } from "@glade/contracts/orchestration/visualReply";
import { ENVIRONMENT_DESCRIPTOR_PATH } from "@glade/contracts/workspace/environment";
import { LOCAL_IMAGE_ROUTE_PATH } from "@glade/shared/attachments/localPreviewFiles";
import {
  ATTACHMENT_CANCEL_ROUTE_PATH,
  ATTACHMENT_UPLOAD_ROUTE_PATH,
  VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH,
} from "@glade/shared/transport/binaryTransfer";
import { EDITOR_ICON_ROUTE_PATH } from "@glade/shared/workspace/editorIcons";
import type { ServerAuthDescriptor } from "@glade/contracts/transport/auth/auth";
import type { HttpServerRequest } from "effect/unstable/http";

import type { ServerConfigShape } from "../server/config";
import { isLoopbackAddress } from "./networkAddresses";

// Sockets accepted by the remote access listener. They are handed to the same HTTP server as the
// app's own loopback connections, so this mark is the only thing that tells them apart.
const remoteSockets = new WeakSet<Socket>();

export function markRemoteSocket(socket: Socket): void {
  remoteSockets.add(socket);
}

export function isRemoteRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const socket = NodeHttpServerRequest.toIncomingMessage(request).socket;
  return socket !== undefined && remoteSockets.has(socket);
}

// Tailscale Serve terminates TLS and forwards over loopback. Only that path can vouch for HTTPS; a
// device on the network could send the same header over plain HTTP.
function secureRemoteOrigin(request: HttpServerRequest.HttpServerRequest): URL | null {
  const socket = NodeHttpServerRequest.toIncomingMessage(request).socket;
  const host = request.headers.host;
  if (!host || !isLoopbackAddress(socket?.remoteAddress ?? "")) return null;
  const forwardedHttps = request.headers["x-forwarded-proto"] === "https";
  if (!forwardedHttps && !host.endsWith(".ts.net")) return null;
  try {
    return new URL(`https://${host}`);
  } catch {
    return null;
  }
}

// How a request from another device sees the server: as a wildcard bind. That turns off the
// loopback-only conveniences (the desktop's URL token, unauthenticated loopback access, the Vite
// dev redirect) and makes HTTPS through Tailscale the trusted origin for cookies and CSRF checks.
export function remoteRequestConfig(
  config: ServerConfigShape,
  request: HttpServerRequest.HttpServerRequest,
): ServerConfigShape {
  return {
    ...config,
    host: "::",
    devUrl: undefined,
    publicUrl: secureRemoteOrigin(request) ?? config.publicUrl,
    allowInsecureRemote: true,
  };
}

const REMOTE_API_PATHS = [
  "/api/auth/",
  ATTACHMENT_UPLOAD_ROUTE_PATH,
  ATTACHMENT_CANCEL_ROUTE_PATH,
  VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH,
  "/api/project-favicon",
  "/api/site-favicon",
  "/api/thread-export",
  EDITOR_ICON_ROUTE_PATH,
  LOCAL_IMAGE_ROUTE_PATH,
  VISUAL_REPLY_ROUTE,
  "/ws",
  ENVIRONMENT_DESCRIPTOR_PATH,
  "/health",
] as const;

// Paths another device may reach. Everything else stays local: the agent gateway, desktop
// lifecycle routes, provider sign-in and runtime proofs serve only this machine's own processes.
export function isRemoteRequestPathAllowed(method: string, pathname: string): boolean {
  if (REMOTE_API_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return true;
  }
  const serverPath =
    pathname.startsWith("/api/") || pathname === "/api" || pathname.startsWith("/mcp");
  return !serverPath && (method === "GET" || method === "HEAD");
}

// Another device can only pair with a one-time link, whatever this machine's own app uses.
export function authDescriptorFor(
  request: HttpServerRequest.HttpServerRequest,
  local: ServerAuthDescriptor,
): ServerAuthDescriptor {
  return isRemoteRequest(request)
    ? { ...local, policy: "remote-reachable", bootstrapMethods: ["one-time-token"] }
    : local;
}
