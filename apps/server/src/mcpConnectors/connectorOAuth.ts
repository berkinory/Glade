import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { outboundHttp } from "../platform/outboundHttp/outboundHttp.ts";
import type { StoredOAuth } from "./connectorDocument.ts";

const OAUTH_CLIENT_NAME = "Glade";
const OAUTH_CLIENT_URI = "https://useglade.dev";
// Glade's OAuth Client ID Metadata Document, served from apps/landing/public/oauth/client.json.
// The URL is Glade's client identity at every vendor that supports it; changing it orphans every
// sign-in made with it.
export const GLADE_CLIENT_METADATA_URL = "https://useglade.dev/oauth/client.json";
const CLIENT_METADATA_REDIRECT_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type OutboundMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
const OUTBOUND_METHODS = new Set<string>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function requestBodyText(body: RequestInit["body"]): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("Unsupported OAuth request body.");
}

// The SDK's fetch: each call may reach only the origin it names, at a public address, bounded in
// time and size. Discovery documents, registration and token endpoints often live on other hosts
// than the MCP server, so the allowlist is per request.
async function connectorOAuthFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (!OUTBOUND_METHODS.has(method)) throw new Error(`Unsupported OAuth method ${method}.`);
  const body = requestBodyText(init?.body);
  const response = await outboundHttp.request({
    policy: {
      service: "mcp-connector-oauth",
      allowedOrigins: [url.origin],
      timeoutMs: 20_000,
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 1024 * 1024,
      maxRedirects: 3,
      maxConcurrent: 4,
      maxQueued: 32,
      requirePublicAddress: true,
    },
    url,
    method: method as OutboundMethod,
    ...(init?.headers ? { headers: init.headers } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  const status = response.status >= 200 && response.status <= 599 ? response.status : 502;
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : response.body, { status, headers: response.headers });
}

// A failure written for the person connecting.
export class ConnectorSignInError extends Error {
  override readonly name = "ConnectorSignInError";
}

export interface OAuthChallenge {
  readonly resourceMetadataUrl: string | undefined;
  readonly scope: string | undefined;
}

// Everything the callback needs to finish one sign-in.
export interface PendingOAuthSignIn {
  readonly authorizationServerUrl: string;
  readonly metadata: AuthorizationServerMetadata | undefined;
  readonly clientInformation: OAuthClientInformationMixed;
  readonly codeVerifier: string;
  readonly redirectUrl: string;
  readonly resource: URL | undefined;
}

// Registers a fresh client for every sign-in: the redirect URL carries this server's current port,
// and a cached registration for an old port would strand the user on the vendor's error page.
export async function beginOAuthSignIn(input: {
  readonly serverUrl: string;
  readonly name: string;
  readonly redirectUrl: string;
  readonly state: string;
  readonly challenge: OAuthChallenge;
}): Promise<{ readonly authorizationUrl: URL; readonly pending: PendingOAuthSignIn }> {
  const info = await discoverOAuthServerInfo(input.serverUrl, {
    ...(input.challenge.resourceMetadataUrl
      ? { resourceMetadataUrl: new URL(input.challenge.resourceMetadataUrl) }
      : {}),
    fetchFn: connectorOAuthFetch,
  });
  const metadata = info.authorizationServerMetadata;
  // The metadata document lists loopback redirects only, so a server bound to another host must
  // register instead.
  const metadataDocument =
    metadata?.client_id_metadata_document_supported === true &&
    CLIENT_METADATA_REDIRECT_HOSTS.has(new URL(input.redirectUrl).hostname);
  if (!metadata?.registration_endpoint && !metadataDocument) {
    throw new ConnectorSignInError(
      `${input.name} only accepts apps it registered in advance, so Glade cannot sign in to it.`,
    );
  }
  const scope = input.challenge.scope ?? info.resourceMetadata?.scopes_supported?.join(" ");
  // Registration stays first until vendors are shown to accept the metadata document's portless
  // loopback redirects, since the callback port changes with every launch.
  const clientInformation = metadata.registration_endpoint
    ? await registerGladeClient(info.authorizationServerUrl, metadata, input, scope)
    : { client_id: GLADE_CLIENT_METADATA_URL };
  const resource = info.resourceMetadata?.resource
    ? new URL(info.resourceMetadata.resource)
    : undefined;
  const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
    metadata,
    clientInformation,
    redirectUrl: input.redirectUrl,
    state: input.state,
    ...(scope ? { scope } : {}),
    ...(resource ? { resource } : {}),
  });
  return {
    authorizationUrl,
    pending: {
      authorizationServerUrl: info.authorizationServerUrl,
      metadata,
      clientInformation,
      codeVerifier,
      redirectUrl: input.redirectUrl,
      resource,
    },
  };
}

function registerGladeClient(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata,
  input: { readonly name: string; readonly redirectUrl: string },
  scope: string | undefined,
): Promise<OAuthClientInformationMixed> {
  return registerClient(authorizationServerUrl, {
    metadata,
    clientMetadata: {
      client_name: OAUTH_CLIENT_NAME,
      client_uri: OAUTH_CLIENT_URI,
      redirect_uris: [input.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(scope ? { scope } : {}),
    },
    ...(scope ? { scope } : {}),
    fetchFn: connectorOAuthFetch,
  }).catch((cause: unknown) => {
    // Vendors that admit only reviewed apps answer with anything from a bare 403 to a redirect
    // complaint, and the SDK's parse errors mean nothing to the person connecting.
    throw new ConnectorSignInError(
      `${input.name} did not let Glade register as an app, so Glade cannot sign in to it.`,
      { cause },
    );
  });
}

function expiresAt(tokens: OAuthTokens, nowMs: number): number | null {
  return typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
    ? nowMs + tokens.expires_in * 1000
    : null;
}

export async function completeOAuthSignIn(
  pending: PendingOAuthSignIn,
  authorizationCode: string,
  nowMs: number,
): Promise<StoredOAuth> {
  const tokens = await exchangeAuthorization(pending.authorizationServerUrl, {
    ...(pending.metadata ? { metadata: pending.metadata } : {}),
    clientInformation: pending.clientInformation,
    authorizationCode,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUrl,
    ...(pending.resource ? { resource: pending.resource } : {}),
    fetchFn: connectorOAuthFetch,
  });
  return {
    kind: "oauth",
    authorizationServerUrl: pending.authorizationServerUrl,
    authorizationServerMetadata: pending.metadata ?? null,
    clientInformation: { ...pending.clientInformation },
    tokens: { ...tokens },
    expiresAt: expiresAt(tokens, nowMs),
    resource: pending.resource?.href ?? null,
  };
}

function clientInformationOf(oauth: StoredOAuth): OAuthClientInformationMixed {
  return oauth.clientInformation as OAuthClientInformationMixed;
}

function metadataOf(oauth: StoredOAuth): AuthorizationServerMetadata | undefined {
  return (oauth.authorizationServerMetadata ?? undefined) as
    | AuthorizationServerMetadata
    | undefined;
}

export function oauthAccessToken(oauth: StoredOAuth): string {
  return String(oauth.tokens.access_token);
}

export function oauthRefreshToken(oauth: StoredOAuth): string | undefined {
  const token = oauth.tokens.refresh_token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export async function refreshOAuthSignIn(
  oauth: StoredOAuth,
  refreshToken: string,
  nowMs: number,
): Promise<StoredOAuth> {
  const metadata = metadataOf(oauth);
  const tokens = await refreshAuthorization(oauth.authorizationServerUrl, {
    ...(metadata ? { metadata } : {}),
    clientInformation: clientInformationOf(oauth),
    refreshToken,
    ...(oauth.resource ? { resource: new URL(oauth.resource) } : {}),
    fetchFn: connectorOAuthFetch,
  });
  return {
    ...oauth,
    // Servers that do not rotate refresh tokens leave them out of the response.
    tokens: { ...tokens, refresh_token: tokens.refresh_token ?? refreshToken },
    expiresAt: expiresAt(tokens, nowMs),
  };
}

// RFC 6749 §5.2 errors after which the refresh token or client never works again. Anything else,
// such as rate limits or server errors, may clear up and must not cost the user their sign-in.
const LOST_GRANT_ERROR_CODES = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

export function isLostOAuthGrant(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { readonly errorCode?: unknown }).errorCode;
  return typeof code === "string" && LOST_GRANT_ERROR_CODES.has(code);
}

// Best-effort RFC 7009 revocation. The tokens are deleted locally either way, and the vendor's own
// settings can still revoke the grant.
export async function revokeOAuthSignIn(oauth: StoredOAuth): Promise<void> {
  const endpoint = oauth.authorizationServerMetadata?.revocation_endpoint;
  if (typeof endpoint !== "string") return;
  const client = clientInformationOf(oauth);
  const candidates: ReadonlyArray<readonly [string | undefined, string]> = [
    [oauthRefreshToken(oauth), "refresh_token"],
    [oauthAccessToken(oauth), "access_token"],
  ];
  for (const [token, hint] of candidates) {
    if (!token) continue;
    const body = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id });
    if (client.client_secret) body.set("client_secret", client.client_secret);
    await connectorOAuthFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).catch(() => undefined);
  }
}
