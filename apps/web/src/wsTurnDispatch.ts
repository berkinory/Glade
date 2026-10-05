import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import type { ClientOrchestrationCommand } from "@glade/contracts/orchestration/commands";
import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationSettleTurnDispatchResult,
} from "@glade/contracts/orchestration/rpc";
import {
  WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY,
  type WsBootstrapNegotiateResult,
} from "@glade/contracts/transport/ws/wsCompatibility";
import { RpcClientError } from "effect/unstable/rpc";
import { Schema } from "effect";
import { usePendingTurnDispatchStore } from "./pendingTurnDispatch";
import {
  delayWithAbort,
  isRuntimeInterruptFailure,
  isTerminalCompatibilityFailure,
  WsTransportRequestInterruptedError,
  WsTransportRpcError,
  type WsRequestOptions,
} from "./wsTransport.support";

type TurnCommand = Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>;
interface TurnDispatchTransport {
  request: <T>(method: string, params?: unknown, options?: WsRequestOptions) => Promise<T>;
  getCompatibility: () => WsBootstrapNegotiateResult | null;
}

export function isTurnDispatchOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof WsTransportRequestInterruptedError ||
    isRuntimeInterruptFailure(error) ||
    Schema.is(RpcClientError.RpcClientError)(error) ||
    (Schema.is(WsRpcError)(error) &&
      ![
        "ORCHESTRATION_COMMAND_REJECTED",
        "ORCHESTRATION_COMMAND_IDENTITY_COLLISION",
        "ORCHESTRATION_COMMAND_ADMISSION_REJECTED",
      ].includes(error.code ?? ""))
  );
}

export async function dispatchRecoverableTurn(
  transport: TurnDispatchTransport,
  command: TurnCommand,
  lifetime: AbortSignal,
): Promise<{ sequence: number }> {
  try {
    return await transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command });
  } catch (error) {
    if (!isTurnDispatchOutcomeUnknown(error)) throw error;
    const owner = usePendingTurnDispatchStore.getState();
    owner.setDelivery(command.threadId, "recovering", command);
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(90_000)]);
    let failure = error;
    let verdict: OrchestrationSettleTurnDispatchResult | null = null;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        signal.throwIfAborted();
        try {
          verdict = await transport.request<OrchestrationSettleTurnDispatchResult>(
            ORCHESTRATION_WS_METHODS.settleTurnDispatch,
            { command },
            { timeoutMs: 25_000, signal },
          );
          break;
        } catch (settlementError) {
          failure = settlementError;
          if (
            signal.aborted ||
            isTerminalCompatibilityFailure(settlementError) ||
            (Schema.is(WsRpcError)(settlementError) && settlementError.retryable === false) ||
            !transport
              .getCompatibility()
              ?.capabilities.includes(WS_TURN_DISPATCH_SETTLEMENT_CAPABILITY)
          )
            break;
          if (attempt < 2) await delayWithAbort(500 * 2 ** attempt, signal);
        }
      }
    } catch (recoveryError) {
      failure = recoveryError;
    }
    if (verdict !== null) {
      owner.setDelivery(command.threadId, null);
      if (verdict.status === "accepted") return { sequence: verdict.sequence };
      throw new WsTransportRpcError({ message: verdict.message });
    }
    owner.setDelivery(command.threadId, "uncertain", command);
    throw new WsTransportRequestInterruptedError({
      message:
        "Message delivery remains uncertain. Check this conversation before sending again; your draft and uploads are preserved.",
      code: "WS_TURN_SETTLEMENT_UNAVAILABLE",
      method: ORCHESTRATION_WS_METHODS.dispatchCommand,
      cause: failure,
      retryable: false,
    });
  }
}
