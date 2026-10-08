import { activeEnvironment } from "../environments/activeEnvironment";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import {
  currentNormalizingEnvironment,
  environmentWsUrl,
} from "../environments/environmentEndpoints";

function localWsUrl(): string | null {
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  return typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
    ? bridgeWsUrl
    : typeof envWsUrl === "string" && envWsUrl.length > 0
      ? envWsUrl
      : null;
}

// An HTTP URL on an environment's server, defaulting to the chat on screen. An SSH host that is not
// connected has no address, so its URLs fall back to the page origin and fail rather than reaching
// the local server with another server's ids.
export function resolveWsHttpUrl(
  rawPath: string,
  environmentKey: EnvironmentKey = activeEnvironment(),
): string {
  if (typeof window === "undefined") return rawPath;
  const wsCandidate =
    environmentKey === LOCAL_ENVIRONMENT ? localWsUrl() : environmentWsUrl(environmentKey);
  if (!wsCandidate) return new URL(rawPath, window.location.origin).toString();
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    const serverUrl = new URL(`${protocol}//${wsUrl.host}`);
    const httpUrl = new URL(rawPath, serverUrl);
    const legacyToken = wsUrl.searchParams.get("token");
    const targetsServerOrigin =
      httpUrl.protocol === serverUrl.protocol && httpUrl.host === serverUrl.host;
    if (legacyToken && targetsServerOrigin && !httpUrl.searchParams.has("token")) {
      httpUrl.searchParams.set("token", legacyToken);
    }
    return httpUrl.toString();
  } catch {
    return new URL(rawPath, window.location.origin).toString();
  }
}

export function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return resolveWsHttpUrl(rawUrl, currentNormalizingEnvironment() ?? activeEnvironment());
  }
  return rawUrl;
}
