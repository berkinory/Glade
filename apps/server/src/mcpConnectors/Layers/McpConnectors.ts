import { randomBytes, randomUUID } from "node:crypto";

import type {
  McpConnector,
  McpConnectorConnectInput,
  McpConnectorProviders,
  McpConnectorsState,
} from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import type { McpCatalog as McpCatalogDocument } from "@glade/contracts/server/mcpCatalog";
import { normalizeMcpConnectorUrl } from "@glade/shared/mcpConnectors/connectorUrl";
import { Clock, Data, Effect, Layer, Ref, Semaphore, SubscriptionRef } from "effect";

import { version as clientVersion } from "../../../package.json" with { type: "json" };
import { AgentGatewayCredentialsWithSecretsLive } from "../../agentGateway/Layers/AgentGatewayCredentials.ts";
import { AgentGatewayCredentials } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore.ts";
import { McpCatalogLive } from "../../mcpCatalog/Layers/McpCatalog.ts";
import { McpCatalog } from "../../mcpCatalog/Services/McpCatalog.ts";
import {
  type ConnectorsDocument,
  decodeConnectorsDocument,
  EMPTY_CONNECTORS_DOCUMENT,
  encodeConnectorsDocument,
  type StoredAuth,
  type StoredConnector,
  type StoredOAuth,
} from "../connectorDocument.ts";
import {
  beginOAuthSignIn,
  completeOAuthSignIn,
  isLostOAuthGrant,
  oauthAccessToken,
  oauthRefreshToken,
  type PendingOAuthSignIn,
  refreshOAuthSignIn,
  revokeOAuthSignIn,
} from "../connectorOAuth.ts";
import { describeSignInFailure, serverNameFor } from "../connectorNaming.ts";
import { describeUpstreamFailure, openUpstream, probeConnector } from "../connectorTransport.ts";
import {
  McpConnectors,
  McpConnectorsError,
  type McpConnectorsShape,
} from "../Services/McpConnectors.ts";

export const MCP_CONNECTOR_OAUTH_CALLBACK_PATH = "/oauth/mcp/callback";

const SECRET_NAME = "mcp-connectors";
const MAX_CONNECTORS = 50;
const SIGN_IN_TTL_MS = 10 * 60_000;
const MAX_SIGN_INS = 16;
// Refresh a little early so a token does not expire between the check and the vendor's answer.
const REFRESH_LEEWAY_MS = 60_000;

interface ConnectorTarget {
  readonly presetId: string | null;
  readonly name: string;
  readonly url: string;
  // Undefined keeps the agents a reconnected connector already had.
  readonly providers: McpConnectorProviders | undefined;
}

interface SignInAttempt {
  readonly attemptId: string;
  readonly state: string;
  readonly target: ConnectorTarget;
  readonly pending: PendingOAuthSignIn;
  readonly startedAt: number;
  // "exchanging": the callback claimed the single-use state and is redeeming the code.
  readonly status: "waiting" | "exchanging" | "failed";
  readonly message: string | null;
}

class AccessFailure extends Data.TaggedError("AccessFailure")<{ readonly message: string }> {}

class RefreshFailure extends Data.TaggedError("RefreshFailure")<{ readonly cause: unknown }> {}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toContract(connector: StoredConnector): McpConnector {
  return {
    connectorId: connector.connectorId,
    presetId: connector.presetId,
    name: connector.name,
    url: connector.url,
    authKind: connector.auth.kind,
    status: connector.status,
    connectedAt: connector.connectedAt,
    providers: connector.providers ?? null,
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// The vendor sends the browser, and with it the authorization code, to this origin, so it must be
// a loopback port of the user's own machine.
function loopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && url.port
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function resolveTarget(
  input: McpConnectorConnectInput,
  catalog: McpCatalogDocument,
): ConnectorTarget | McpConnectorsError {
  if (input.providers?.length === 0) {
    return new McpConnectorsError({ message: "Choose at least one agent." });
  }
  if ((input.presetId === undefined) === (input.url === undefined)) {
    return new McpConnectorsError({ message: "Choose a connector or enter a server URL." });
  }
  if (input.presetId !== undefined) {
    const preset = catalog.presets.find((entry) => entry.id === input.presetId);
    if (!preset) return new McpConnectorsError({ message: "Glade does not know this connector." });
    if (preset.auth === "token" && !input.token?.trim()) {
      return new McpConnectorsError({ message: `Enter a ${preset.name} token.` });
    }
    return { presetId: preset.id, name: preset.name, url: preset.url, providers: input.providers };
  }
  const checked = normalizeMcpConnectorUrl(input.url ?? "");
  if (!checked.ok) return new McpConnectorsError({ message: checked.reason });
  const name = input.name?.trim().slice(0, 80) || new URL(checked.url).host;
  return { presetId: null, name, url: checked.url, providers: input.providers };
}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore;
  const credentials = yield* AgentGatewayCredentials;
  const catalog = yield* McpCatalog;

  const loaded = yield* secrets.get(SECRET_NAME).pipe(
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => decodeConnectorsDocument(bytes ? textDecoder.decode(bytes) : null),
        catch: (cause) =>
          new McpConnectorsError({ message: "The saved connectors are unreadable.", cause }),
      }),
    ),
    Effect.map((document) => ({ document, readable: true })),
    // The parse error can quote the stored document, tokens included, so it is not logged.
    Effect.catchCause(() =>
      Effect.logWarning("mcp_connectors.load_failed").pipe(
        Effect.as({ document: EMPTY_CONNECTORS_DOCUMENT, readable: false }),
      ),
    ),
  );
  const documentRef = yield* Ref.make<ConnectorsDocument>(loaded.document);
  const attemptsRef = yield* Ref.make<ReadonlyMap<string, SignInAttempt>>(new Map());
  const view = yield* SubscriptionRef.make<McpConnectorsState>({ connectors: [], signIns: [] });
  const writeLock = yield* Semaphore.make(1);
  const refreshLocks = new Map<string, Semaphore.Semaphore>();

  const publish = Effect.gen(function* () {
    const document = yield* Ref.get(documentRef);
    const attempts = yield* Ref.get(attemptsRef);
    yield* SubscriptionRef.set(view, {
      connectors: document.connectors.map(toContract),
      signIns: [...attempts.values()].map((attempt) => ({
        attemptId: attempt.attemptId,
        name: attempt.target.name,
        state: attempt.status === "failed" ? ("failed" as const) : ("waiting" as const),
        message: attempt.message,
      })),
    });
    credentials.connectorGrants?.publish(
      document.connectors
        .filter((connector) => connector.status === "connected")
        .map(({ connectorId, serverName, providers }) => ({
          connectorId,
          serverName,
          providers: providers ?? null,
        })),
    );
  });

  // Derives each change from committed state and saves it before anyone can observe it, so a
  // failed save never reaches the UI or new provider sessions.
  const commit = <A>(
    change: (document: ConnectorsDocument) => readonly [ConnectorsDocument, A],
  ): Effect.Effect<A, McpConnectorsError> =>
    writeLock.withPermit(
      Effect.gen(function* () {
        if (!loaded.readable) {
          return yield* new McpConnectorsError({
            message:
              "Glade could not read your saved connectors, so it won't change them. Restart Glade and try again.",
          });
        }
        const [next, result] = change(yield* Ref.get(documentRef));
        yield* secrets
          .set(SECRET_NAME, textEncoder.encode(encodeConnectorsDocument(next)))
          .pipe(
            Effect.mapError(
              (cause) =>
                new McpConnectorsError({ message: "Glade could not save the connector.", cause }),
            ),
          );
        yield* Ref.set(documentRef, next);
        yield* publish;
        return result;
      }),
    );

  const updateAttempts = (
    change: (live: Map<string, SignInAttempt>) => Map<string, SignInAttempt>,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Ref.update(attemptsRef, (attempts) => {
        const live = new Map(
          [...attempts].filter(([, attempt]) => now - attempt.startedAt < SIGN_IN_TTL_MS),
        );
        return change(live);
      });
      yield* publish;
    });

  const revokeInBackground = (oauth: StoredOAuth) =>
    Effect.forkDetach(Effect.promise(() => revokeOAuthSignIn(oauth))).pipe(Effect.asVoid);

  const upsert = (target: ConnectorTarget, auth: StoredAuth) =>
    Effect.gen(function* () {
      const connectedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      return yield* commit((document) => {
        const existing = document.connectors.find((connector) => connector.url === target.url);
        const connector: StoredConnector = {
          connectorId: existing?.connectorId ?? randomBytes(9).toString("base64url"),
          presetId: target.presetId,
          name: target.name,
          url: target.url,
          serverName:
            existing?.serverName ??
            serverNameFor(
              target.name,
              document.connectors.map((entry) => entry.serverName),
            ),
          status: "connected",
          connectedAt,
          providers:
            target.providers === undefined ? (existing?.providers ?? null) : target.providers,
          auth,
        };
        const others = document.connectors.filter((entry) => entry !== existing);
        return [
          { ...document, connectors: [...others, connector] },
          { connector, existing },
        ] as const;
      }).pipe(
        Effect.tap(({ existing }) =>
          // A reconnect replaces the old sign-in; its grant would otherwise stay live at the vendor.
          existing?.auth.kind === "oauth" && existing.auth !== auth
            ? revokeInBackground(existing.auth)
            : Effect.void,
        ),
        Effect.map(({ connector }) => connector),
      );
    });

  const connect: McpConnectorsShape["connect"] = (input) =>
    Effect.gen(function* () {
      const target = resolveTarget(input, yield* catalog.current);
      if (target instanceof McpConnectorsError) return yield* target;
      const document = yield* Ref.get(documentRef);
      const reconnecting = document.connectors.some((connector) => connector.url === target.url);
      if (!reconnecting && document.connectors.length >= MAX_CONNECTORS) {
        return yield* new McpConnectorsError({
          message: `Glade keeps at most ${MAX_CONNECTORS} MCP servers. Disconnect one first.`,
        });
      }
      const token = input.token?.trim() || undefined;
      const probe = yield* Effect.promise(() =>
        probeConnector({ url: target.url, name: target.name, clientVersion, token }),
      );
      if (probe.kind === "unavailable") {
        return yield* new McpConnectorsError({ message: probe.message });
      }
      if (probe.kind === "open") {
        const connector = yield* upsert(
          target,
          token ? { kind: "token", token } : { kind: "none" },
        );
        return { kind: "connected" as const, connector: toContract(connector) };
      }

      yield* updateAttempts((live) => live);
      const attempts = yield* Ref.get(attemptsRef);
      if (attempts.size >= MAX_SIGN_INS) {
        return yield* new McpConnectorsError({
          message: "Too many sign-ins are open. Finish or cancel one first.",
        });
      }
      const attemptId = randomUUID();
      const state = randomBytes(32).toString("base64url");
      const callbackOrigin =
        input.callbackOrigin === undefined ? undefined : loopbackOrigin(input.callbackOrigin);
      if (callbackOrigin === null) {
        return yield* new McpConnectorsError({
          message: `${target.name} needs a browser sign-in, which this machine cannot receive from here. Connect it with a token, or from that machine's Glade.`,
        });
      }
      const redirectUrl = `${callbackOrigin ?? new URL(credentials.mcpEndpointUrl).origin}${MCP_CONNECTOR_OAUTH_CALLBACK_PATH}`;
      const started = yield* Effect.tryPromise({
        try: () =>
          beginOAuthSignIn({
            serverUrl: target.url,
            name: target.name,
            redirectUrl,
            state,
            challenge: probe.challenge,
          }),
        catch: (cause) =>
          new McpConnectorsError({ message: describeSignInFailure(cause, target.name), cause }),
      });
      const startedAt = yield* Clock.currentTimeMillis;
      yield* updateAttempts((live) =>
        live.set(attemptId, {
          attemptId,
          state,
          target,
          pending: started.pending,
          startedAt,
          status: "waiting",
          message: null,
        }),
      );
      return {
        kind: "authorize" as const,
        attemptId,
        authorizationUrl: started.authorizationUrl.href,
      };
    });

  const cancelSignIn: McpConnectorsShape["cancelSignIn"] = (attemptId) =>
    updateAttempts((live) => {
      live.delete(attemptId);
      return live;
    });

  const failAttempt = (attempt: SignInAttempt, message: string) =>
    updateAttempts((live) =>
      live.has(attempt.attemptId)
        ? live.set(attempt.attemptId, { ...attempt, status: "failed", message })
        : live,
    );

  const completeSignIn: McpConnectorsShape["completeSignIn"] = (query) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // Claimed in one step so a reloaded or prefetched callback cannot redeem the state twice.
      const attempt = yield* Ref.modify(attemptsRef, (attempts) => {
        const found = [...attempts.values()].find(
          (entry) =>
            query.state !== undefined &&
            entry.state === query.state &&
            entry.status === "waiting" &&
            now - entry.startedAt < SIGN_IN_TTL_MS,
        );
        if (!found) return [undefined, attempts] as const;
        const next = new Map(attempts);
        next.set(found.attemptId, { ...found, status: "exchanging" });
        return [found, next] as const;
      });
      if (!attempt) {
        yield* updateAttempts((live) => live);
        return {
          ok: false as const,
          title: "This sign-in has expired",
          message: "Start it again from Settings → MCP servers in Glade.",
        };
      }
      const name = attempt.target.name;
      if (query.error !== undefined || query.code === undefined) {
        const message =
          query.error === "access_denied"
            ? "The sign-in was cancelled."
            : (query.errorDescription ?? `${name} did not finish the sign-in.`);
        yield* failAttempt(attempt, message);
        return { ok: false as const, title: `${name} is not connected`, message };
      }
      const code = query.code;
      const signedIn = yield* Effect.tryPromise({
        try: () => completeOAuthSignIn(attempt.pending, code, now),
        catch: (cause) => new McpConnectorsError({ message: describeSignInFailure(cause, name) }),
      }).pipe(Effect.result);
      if (signedIn._tag === "Failure") {
        yield* failAttempt(attempt, signedIn.failure.message);
        return {
          ok: false as const,
          title: `${name} is not connected`,
          message: signedIn.failure.message,
        };
      }
      // Cancelled from Settings while the code was being exchanged.
      if (!(yield* Ref.get(attemptsRef)).has(attempt.attemptId)) {
        yield* Effect.promise(() => revokeOAuthSignIn(signedIn.success));
        return {
          ok: false as const,
          title: "This sign-in was cancelled",
          message: "Nothing was connected.",
        };
      }
      const saved = yield* upsert(attempt.target, signedIn.success).pipe(Effect.result);
      if (saved._tag === "Failure") {
        yield* failAttempt(attempt, saved.failure.message);
        return {
          ok: false as const,
          title: `${name} is not connected`,
          message: saved.failure.message,
        };
      }
      yield* cancelSignIn(attempt.attemptId);
      return { ok: true as const, name };
    });

  const disconnect: McpConnectorsShape["disconnect"] = (connectorId) =>
    Effect.gen(function* () {
      const removed = yield* commit((document) => {
        const connector = document.connectors.find((entry) => entry.connectorId === connectorId);
        return [
          { ...document, connectors: document.connectors.filter((entry) => entry !== connector) },
          connector,
        ] as const;
      });
      refreshLocks.delete(connectorId);
      // Revoke only once the removal is saved, so a failed save leaves the connector usable.
      if (removed?.auth.kind === "oauth") yield* revokeInBackground(removed.auth);
    });

  const setProviders: McpConnectorsShape["setProviders"] = (connectorId, providers) =>
    Effect.gen(function* () {
      if (providers?.length === 0) {
        return yield* new McpConnectorsError({ message: "Choose at least one agent." });
      }
      const found = yield* commit((document) => [
        {
          ...document,
          connectors: document.connectors.map((entry) =>
            entry.connectorId === connectorId ? { ...entry, providers } : entry,
          ),
        },
        document.connectors.some((entry) => entry.connectorId === connectorId),
      ]);
      if (!found) {
        return yield* new McpConnectorsError({ message: "This connector is no longer connected." });
      }
    });

  const findConnector = (connectorId: string) =>
    Ref.get(documentRef).pipe(
      Effect.map((document) =>
        document.connectors.find((connector) => connector.connectorId === connectorId),
      ),
    );

  // Replaces the OAuth record only if it is still the one the refresh started from: a reconnect or
  // disconnect that finished meanwhile owns the connector now. Rotated refresh tokens are often
  // single-use, so the new record stays in memory even when saving it fails.
  const replaceOAuth = (connectorId: string, from: StoredOAuth, change: Partial<StoredConnector>) =>
    writeLock.withPermit(
      Effect.gen(function* () {
        const document = yield* Ref.get(documentRef);
        const index = document.connectors.findIndex(
          (connector) => connector.connectorId === connectorId && connector.auth === from,
        );
        const current = document.connectors[index];
        if (!current) return false;
        const connectors = document.connectors.with(index, { ...current, ...change });
        const next = { ...document, connectors };
        if (loaded.readable) {
          yield* secrets
            .set(SECRET_NAME, textEncoder.encode(encodeConnectorsDocument(next)))
            .pipe(Effect.catch(() => Effect.logWarning("mcp_connectors.token_save_failed")));
        }
        yield* Ref.set(documentRef, next);
        yield* publish;
        return true;
      }),
    );

  const refreshLock = (connectorId: string) =>
    Effect.gen(function* () {
      const existing = refreshLocks.get(connectorId);
      if (existing) return existing;
      const created = yield* Semaphore.make(1);
      refreshLocks.set(connectorId, created);
      return created;
    });

  const accessToken = (
    connector: StoredConnector,
    oauth: StoredOAuth,
    force: boolean,
  ): Effect.Effect<string, AccessFailure> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const fresh = (record: StoredOAuth) =>
        record.expiresAt === null || record.expiresAt - now > REFRESH_LEEWAY_MS;
      if (!force && fresh(oauth)) return oauthAccessToken(oauth);
      const lock = yield* refreshLock(connector.connectorId);
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const current = yield* findConnector(connector.connectorId);
          if (current?.auth.kind !== "oauth") {
            return yield* new AccessFailure({
              message: `${connector.name} was disconnected in Glade.`,
            });
          }
          // Concurrent calls share one refresh: refresh tokens may be single-use.
          if (current.auth !== oauth && fresh(current.auth)) return oauthAccessToken(current.auth);
          const record = current.auth;
          const refreshToken = oauthRefreshToken(record);
          if (!refreshToken) return oauthAccessToken(record);
          const refreshed = yield* Effect.tryPromise({
            try: () => refreshOAuthSignIn(record, refreshToken, now),
            catch: (cause) => new RefreshFailure({ cause }),
          }).pipe(Effect.result);
          if (refreshed._tag === "Success") {
            const kept = yield* replaceOAuth(connector.connectorId, record, {
              auth: refreshed.success,
            });
            if (kept) return oauthAccessToken(refreshed.success);
            // Disconnected or reconnected during the refresh: the fresh grant belongs to nobody.
            yield* revokeInBackground(refreshed.success);
            const latest = yield* findConnector(connector.connectorId);
            if (latest?.auth.kind === "oauth") return oauthAccessToken(latest.auth);
            return yield* new AccessFailure({
              message: `${connector.name} was disconnected in Glade.`,
            });
          }
          if (isLostOAuthGrant(refreshed.failure.cause)) {
            yield* replaceOAuth(connector.connectorId, record, { status: "needs-sign-in" });
            return yield* new AccessFailure({
              message: `${connector.name} needs you to sign in again in Glade: Settings → MCP servers.`,
            });
          }
          yield* Effect.logWarning("mcp_connectors.refresh_failed", {
            connector: connector.name,
            cause: refreshed.failure.cause,
          });
          return yield* new AccessFailure({
            message: `Glade could not refresh access to ${connector.name}. Try again shortly.`,
          });
        }),
      );
    });

  const bearerFor = (connector: StoredConnector, force: boolean) =>
    connector.auth.kind === "oauth"
      ? accessToken(connector, connector.auth, force)
      : Effect.succeed(connector.auth.kind === "token" ? connector.auth.token : undefined);

  const forward: McpConnectorsShape["forward"] = (connectorId, request) =>
    Effect.gen(function* () {
      const connector = yield* findConnector(connectorId);
      if (!connector) {
        return { kind: "failure" as const, message: "This connector was disconnected in Glade." };
      }
      if (connector.status === "needs-sign-in") {
        return {
          kind: "failure" as const,
          message: `${connector.name} needs you to sign in again in Glade: Settings → MCP servers.`,
        };
      }
      for (let attempt = 0; ; attempt += 1) {
        const retry = attempt > 0;
        const bearer = yield* bearerFor(connector, retry).pipe(Effect.result);
        if (bearer._tag === "Failure") {
          return { kind: "failure" as const, message: bearer.failure.message };
        }
        const opened = yield* Effect.tryPromise({
          try: (signal) => openUpstream(connector.url, request, bearer.success, signal),
          catch: (cause) => describeUpstreamFailure(cause, connector.name),
        }).pipe(Effect.result);
        if (opened._tag === "Failure") return { kind: "failure" as const, message: opened.failure };
        const response = opened.success;
        if (response.status === 401) {
          yield* Effect.promise(() => response.body.cancel().catch(() => undefined));
          if (connector.auth.kind === "oauth" && !retry) continue;
          return {
            kind: "failure" as const,
            message:
              connector.auth.kind === "token"
                ? `${connector.name} rejected the saved token. Reconnect it with a new token in Glade: Settings → MCP servers.`
                : `${connector.name} rejected Glade's sign-in. Reconnect it in Glade: Settings → MCP servers.`,
          };
        }
        return {
          kind: "response" as const,
          status: response.status,
          contentType: response.headers.get("content-type"),
          sessionId: response.headers.get("mcp-session-id"),
          body: response.body,
        };
      }
    });

  yield* publish;

  return {
    streamState: SubscriptionRef.changes(view),
    catalog: catalog.current,
    connect,
    cancelSignIn,
    disconnect,
    setProviders,
    completeSignIn,
    forward,
  } satisfies McpConnectorsShape;
});

export const McpConnectorsLive = Layer.effect(McpConnectors, make).pipe(
  Layer.provide(AgentGatewayCredentialsWithSecretsLive),
  Layer.provide(ServerSecretStoreLive),
  Layer.provide(McpCatalogLive),
);
