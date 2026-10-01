import type { OrchestrationMessage } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderApprovalDecision } from "@glade/contracts/provider/sessionPolicy";
import { Effect } from "effect";

import type { ComputerApprovalGate } from "../computer/ComputerApprovalGate.ts";
import {
  COMPUTER_FOREGROUND_NOT_AUTHORIZED,
  computerForegroundScopeChangedSince,
  computerForegroundAuthorizationForMessages,
  type ComputerForegroundAuthorization,
} from "../computer/computerVisibleUse.ts";
import type { AgentGatewayComputerToolsOptions } from "./computerTools.ts";
import type { ToolContext } from "./toolRuntime.ts";

function lastUserRowId(messages: readonly OrchestrationMessage[]): string | undefined {
  return messages.findLast((message) => message.role === "user")?.id;
}

export interface ComputerForegroundConsentOptions {
  readonly gate: Pick<ComputerApprovalGate, "hasForegroundGrant" | "requestForegroundTask">;

  readonly loadMessages: (threadId: string) => Promise<readonly OrchestrationMessage[] | undefined>;
  readonly knownAppNames: () => readonly string[];

  readonly publish: (
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ) => (requestId: string, decision?: ProviderApprovalDecision) => Promise<void>;
}

// Native apps and browsers share it, and full-access mode alone never answers yes. The card is
// asked only when the words did not already answer, and its answer (either way) holds for the turn,
// so the model can neither word its way past it nor make the user repeat it.
export function makeComputerForegroundConsent(options: ComputerForegroundConsentOptions): {
  readonly resolveForegroundAuthorization: NonNullable<
    AgentGatewayComputerToolsOptions["resolveForegroundAuthorization"]
  >;
  readonly requestForegroundConsent: NonNullable<
    AgentGatewayComputerToolsOptions["requestForegroundConsent"]
  >;
} {
  const cardGrantFrontiers = new Map<
    string,
    { turnId: string; lastMessageId: string | undefined }
  >();
  const resolveForegroundAuthorization = async (
    context: ToolContext,
  ): Promise<ComputerForegroundAuthorization> => {
    const messages = await options.loadMessages(context.callerThreadId);
    if (messages === undefined) return COMPUTER_FOREGROUND_NOT_AUTHORIZED;
    const fromMessages = computerForegroundAuthorizationForMessages(messages, {
      knownAppNames: options.knownAppNames(),
    });
    if (fromMessages.userRequestedVisibleUse) return fromMessages;
    const frontier = cardGrantFrontiers.get(context.callerThreadId);
    return context.callerTurnId !== null &&
      frontier?.turnId === context.callerTurnId &&
      options.gate.hasForegroundGrant(context.callerThreadId, context.callerTurnId) &&
      !computerForegroundScopeChangedSince(messages, frontier.lastMessageId)
      ? { userRequestedVisibleUse: true }
      : COMPUTER_FOREGROUND_NOT_AUTHORIZED;
  };

  const requestForegroundConsent = async (
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (context.callerTurnId === null) return false;
    await Effect.runPromise(context.assertCallerTurnActive(), { signal });
    if (options.gate.hasForegroundGrant(context.callerThreadId, context.callerTurnId)) {
      return (await resolveForegroundAuthorization(context)).userRequestedVisibleUse;
    }
    const before = await options.loadMessages(context.callerThreadId);
    if (before === undefined) return false;
    const beforeMessageId = lastUserRowId(before);
    const accepted = await options.gate.requestForegroundTask({
      threadId: context.callerThreadId,
      turnId: context.callerTurnId,
      signal,
      publish: options.publish(name, args, context),
    });
    if (!accepted) return false;
    const messages = await options.loadMessages(context.callerThreadId);
    if (messages === undefined || computerForegroundScopeChangedSince(messages, beforeMessageId))
      return false;
    cardGrantFrontiers.set(context.callerThreadId, {
      turnId: context.callerTurnId,
      lastMessageId: lastUserRowId(messages),
    });
    return true;
  };

  return { resolveForegroundAuthorization, requestForegroundConsent };
}
