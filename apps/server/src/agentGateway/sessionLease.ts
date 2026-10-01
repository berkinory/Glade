import { normalizeOperationError } from "../platform/operationError.ts";
import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Exit } from "effect";

import type {
  AgentGatewayCredentialsShape,
  AgentGatewayMcpConnection,
} from "./Services/AgentGatewayCredentials.ts";
import type { AgentGatewayCapability } from "./Services/AgentGatewaySessionRegistry.ts";

export interface AgentGatewaySessionLeaseOptions {
  readonly additionalCapabilities?: readonly AgentGatewayCapability[];
}

// Adapters never assemble capability lists.
export interface AgentGatewayCapabilityInput {
  readonly enableComputerControl?: boolean | undefined;

  readonly nativeToolCallScope?: boolean | undefined;
}

export const AGENT_GATEWAY_NO_CAPABILITIES: AgentGatewayCapabilityInput = {};

export function agentGatewayCapabilitiesFor(
  input: AgentGatewayCapabilityInput,
): readonly AgentGatewayCapability[] {
  const capabilities: AgentGatewayCapability[] = [];
  if (input.enableComputerControl === true) capabilities.push("computer:control");
  return capabilities;
}

function agentGatewaySessionLeaseOptionsFor(
  input: AgentGatewayCapabilityInput,
): AgentGatewaySessionLeaseOptions | undefined {
  const additionalCapabilities = agentGatewayCapabilitiesFor(input);
  return additionalCapabilities.length === 0 ? undefined : { additionalCapabilities };
}

export function captureAgentGatewayCapabilityInput(
  input: AgentGatewayCapabilityInput,
): AgentGatewayCapabilityInput {
  return {
    enableComputerControl: input.enableComputerControl === true,
    ...(input.nativeToolCallScope ? { nativeToolCallScope: true } : {}),
  };
}

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

  const options = agentGatewaySessionLeaseOptionsFor(capabilityInput);
  const connection =
    options === undefined
      ? credentials.connectionForThread(threadId, provider)
      : credentials.connectionForThread(threadId, provider, options);
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

// The watcher is detached because adapter-owned scopes are themselves closed by normal teardown;
// the idempotent lease reconciles whichever signal (explicit stop or process exit) arrives first.
export function startAgentGatewaySessionLeaseExitWatcher(
  lease: AgentGatewaySessionLease | undefined,
  awaitProviderExit: Effect.Effect<void>,
): Effect.Effect<void> {
  if (lease === undefined) return Effect.void;
  return awaitProviderExit.pipe(
    Effect.andThen(Effect.sync(lease.release)),
    Effect.forkDetach,
    Effect.asVoid,
  );
}

export function releaseAgentGatewaySessionLeaseOnInterrupt<A, E, R>(
  lease: AgentGatewaySessionLease | undefined,
  startup: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  if (lease === undefined) return startup;
  return startup.pipe(Effect.onInterrupt(() => Effect.sync(lease.release)));
}
