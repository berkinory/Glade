import { randomUUID } from "node:crypto";

import { Effect, Layer, Scope, ServiceMap } from "effect";

import {
  CurrentManagedAttachmentPrincipal,
  type ManagedAttachmentPrincipal,
} from "../../attachments/managedAttachmentPrincipal";

export type WsSessionRole = "owner" | "client";

export const CurrentWsSessionRole = ServiceMap.Reference<WsSessionRole>(
  "glade/ws/CurrentSessionRole",
  { defaultValue: () => "client" },
);

export interface WsConnectionSession {
  readonly role: WsSessionRole;
  readonly attachmentPrincipal: ManagedAttachmentPrincipal;
}

// Synthetic header carrying the connection-session key. It is set server-side on the upgrade
// request (never sent to clients), and Headers.set overrides any value a client tried to smuggle
// in, so entries cannot be forged or replayed.
export const WS_CONNECTION_SESSION_HEADER = "x-glade-ws-connection-session";

export interface WsConnectionSessionsShape {
  readonly register: (session: WsConnectionSession) => Effect.Effect<string, never, Scope.Scope>;
  readonly lookup: (key: string | undefined) => WsConnectionSession | undefined;
}

export class WsConnectionSessions extends ServiceMap.Service<
  WsConnectionSessions,
  WsConnectionSessionsShape
>()("glade/ws/WsConnectionSessions") {}

export const makeWsConnectionSessions = Effect.sync(() => {
  const sessions = new Map<string, WsConnectionSession>();
  return {
    register: (session: WsConnectionSession) =>
      Effect.gen(function* () {
        const key = randomUUID();
        sessions.set(key, session);
        yield* Effect.addFinalizer(() => Effect.sync(() => sessions.delete(key)));
        return key;
      }),
    lookup: (key: string | undefined) => (key === undefined ? undefined : sessions.get(key)),
  } satisfies WsConnectionSessionsShape;
});

export const WsConnectionSessionsLive = Layer.effect(
  WsConnectionSessions,
  makeWsConnectionSessions,
);

export function provideWsConnectionSession<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  session: WsConnectionSession | undefined,
): Effect.Effect<A, E, R> {
  return session
    ? effect.pipe(
        Effect.provideService(CurrentWsSessionRole, session.role),
        Effect.provideService(CurrentManagedAttachmentPrincipal, session.attachmentPrincipal),
      )
    : effect;
}
