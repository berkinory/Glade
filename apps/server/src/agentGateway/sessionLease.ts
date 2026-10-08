import { normalizeOperationError } from "../platform/operationError.ts";
import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Exit } from "effect";

import type {
  AgentGatewayCredentialsShape,
  AgentGatewayMcpConnection,
} from "./Services/AgentGatewayCredentials.ts";

export interface AgentGatewayCapabilityInput {
  readonly nativeToolCallScope?: boolean | undefined;
}

export const AGENT_GATEWAY_NO_CAPABILITIES: AgentGatewayCapabilityInput = {};

type AgentGatewaySessionLeaseCredentials = Pick<
  AgentGatewayCredentialsShape,
  "connectionForThread" | "revokeSessionToken"
> &
  Partial<
    Pick<
      AgentGatewayCredentialsShape,
      "cancelSessionTurnRequests" | "retireSessionTurn" | "nativeToolCalls"
    >
  >;

export const AGENT_GATEWAY_CREDENTIAL_ROTATION_REQUIRED = "agentGatewayCredentialRotationRequired";
export const AGENT_GATEWAY_TURN_AUTHORITY_RETIRED = "gladeGatewayTurnAuthorityRetired";

export interface AgentGatewaySessionLease {
  readonly connection: AgentGatewayMcpConnection;
  readonly registerNativeToolCall?: (call: import("./nativeToolCalls.ts").NativeToolCall) => void;
  readonly cancelTurn: (turnId: string) => Promise<void>;
  // Retire write authority for a terminal turn.
  readonly retireTurn: (turnId: string) => Promise<void>;
  readonly release: () => void;
}

interface GatewayTurnCancellation {
  readonly completion: Promise<void>;
}

const AGENT_GATEWAY_TURN_CANCELLATION_TIMEOUT = "2 seconds";

function awaitAgentGatewayTurnCancellation(
  turnId: string,
  cancellation: GatewayTurnCancellation,
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => cancellation.completion,
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.timeoutOrElse({
      duration: AGENT_GATEWAY_TURN_CANCELLATION_TIMEOUT,
      onTimeout: () =>
        Effect.logWarning("agent_gateway.turn_cancellation_timeout", {
          turnId,
          timeout: AGENT_GATEWAY_TURN_CANCELLATION_TIMEOUT,
        }),
    }),
    Effect.catchCause((cause) =>
      Effect.logWarning("agent_gateway.turn_cancellation_failed", { turnId, cause }),
    ),
    Effect.asVoid,
  );
}

function startAgentGatewayTurnCancellation(
  lease: AgentGatewaySessionLease,
  turnId: string,
  retireCredential = false,
): Effect.Effect<GatewayTurnCancellation> {
  return Effect.try({
    try: () => ({
      completion: retireCredential ? lease.retireTurn(turnId) : lease.cancelTurn(turnId),
    }),
    catch: (cause) => normalizeOperationError(cause),
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("agent_gateway.turn_cancellation_failed", { turnId, cause }).pipe(
        Effect.as({ completion: Promise.resolve() }),
      ),
    ),
  );
}

export function cancelAgentGatewayTurn(
  lease: AgentGatewaySessionLease | undefined,
  turnId: string | undefined,
  options?: { readonly retireCredential: boolean },
): Effect.Effect<void> {
  if (lease === undefined || turnId === undefined) return Effect.void;

  return startAgentGatewayTurnCancellation(lease, turnId, options?.retireCredential).pipe(
    Effect.flatMap((cancellation) => awaitAgentGatewayTurnCancellation(turnId, cancellation)),
  );
}

export function withAgentGatewayTurnCancellation<A, E, R>(
  lease: AgentGatewaySessionLease | undefined,
  turnId: string | undefined,
  providerInterrupt: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  if (lease === undefined) return providerInterrupt;

  return Effect.gen(function* () {
    const cancellation =
      turnId === undefined ? undefined : yield* startAgentGatewayTurnCancellation(lease, turnId);
    // The bearer is session-scoped and cannot prove whether a late MCP call originated in this
    // interrupted turn or a later one.
    const releaseExit = yield* Effect.exit(Effect.sync(lease.release));
    const [providerExit] = yield* Effect.all(
      [
        Effect.exit(providerInterrupt),
        turnId === undefined || cancellation === undefined
          ? Effect.void
          : awaitAgentGatewayTurnCancellation(turnId, cancellation),
      ] as const,
      { concurrency: "unbounded" },
    );
    if (Exit.isFailure(providerExit)) {
      return yield* Effect.failCause(providerExit.cause);
    }
    if (Exit.isFailure(releaseExit)) {
      return yield* Effect.failCause(releaseExit.cause);
    }
    return providerExit.value;
  });
}

export function acquireAgentGatewaySessionLease(
  credentials: AgentGatewaySessionLeaseCredentials | undefined,
  threadId: ThreadId,
  provider: ProviderKind,
  capabilityInput: AgentGatewayCapabilityInput,
): AgentGatewaySessionLease | undefined {
  if (credentials === undefined) return undefined;

  const connection = credentials.connectionForThread(threadId, provider);
  const nativeToolCalls = capabilityInput.nativeToolCallScope
    ? credentials.nativeToolCalls
    : undefined;
  nativeToolCalls?.enable(connection.bearerToken);
  let released = false;

  return {
    connection,
    ...(nativeToolCalls
      ? {
          registerNativeToolCall: (call: import("./nativeToolCalls.ts").NativeToolCall) => {
            if (!released) nativeToolCalls.register(connection.bearerToken, call);
          },
        }
      : {}),
    cancelTurn: (turnId) => {
      if (released) return Promise.resolve();
      return (
        credentials.cancelSessionTurnRequests?.(connection.bearerToken, turnId) ?? Promise.resolve()
      );
    },
    retireTurn: (turnId) => {
      if (released) return Promise.resolve();
      return (
        (nativeToolCalls
          ? credentials.cancelSessionTurnRequests?.(connection.bearerToken, turnId)
          : credentials.retireSessionTurn?.(connection.bearerToken, turnId)) ??
        credentials.cancelSessionTurnRequests?.(connection.bearerToken, turnId) ??
        Promise.resolve()
      );
    },
    release: () => {
      if (released) return;
      released = true;
      credentials.revokeSessionToken(connection.bearerToken);
    },
  };
}
