import * as Rpc from "effect/unstable/rpc/Rpc";
import { WS_METHODS } from "./ws";
import {
  AutomationListInput,
  AutomationListResult,
  AutomationGetMemoryInput,
  AutomationMemory,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationUpdateInput,
  AutomationDeleteInput,
  AutomationRunNowInput,
  AutomationRunNowResult,
  AutomationCancelRunInput,
  AutomationCancelRunResult,
  AutomationMarkRunReadInput,
  AutomationRunActionResult,
  AutomationArchiveRunInput,
  AutomationResolveProposalInput,
  AutomationResolveProposalResult,
  AutomationStreamEvent,
} from "../../automation/automation";
import { Schema } from "effect";
import { WsRpcError } from "./rpcErrors";

export const WsAutomationListRpc = Rpc.make(WS_METHODS.automationList, {
  payload: AutomationListInput,
  success: AutomationListResult,
  error: WsRpcError,
});

export const WsAutomationGetMemoryRpc = Rpc.make(WS_METHODS.automationGetMemory, {
  payload: AutomationGetMemoryInput,
  success: Schema.NullOr(AutomationMemory),
  error: WsRpcError,
});

export const WsAutomationCreateRpc = Rpc.make(WS_METHODS.automationCreate, {
  payload: AutomationCreateInput,
  success: AutomationDefinition,
  error: WsRpcError,
});

export const WsAutomationUpdateRpc = Rpc.make(WS_METHODS.automationUpdate, {
  payload: AutomationUpdateInput,
  success: AutomationDefinition,
  error: WsRpcError,
});

export const WsAutomationDeleteRpc = Rpc.make(WS_METHODS.automationDelete, {
  payload: AutomationDeleteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsAutomationRunNowRpc = Rpc.make(WS_METHODS.automationRunNow, {
  payload: AutomationRunNowInput,
  success: AutomationRunNowResult,
  error: WsRpcError,
});

export const WsAutomationCancelRunRpc = Rpc.make(WS_METHODS.automationCancelRun, {
  payload: AutomationCancelRunInput,
  success: AutomationCancelRunResult,
  error: WsRpcError,
});

export const WsAutomationMarkRunReadRpc = Rpc.make(WS_METHODS.automationMarkRunRead, {
  payload: AutomationMarkRunReadInput,
  success: AutomationRunActionResult,
  error: WsRpcError,
});

export const WsAutomationArchiveRunRpc = Rpc.make(WS_METHODS.automationArchiveRun, {
  payload: AutomationArchiveRunInput,
  success: AutomationRunActionResult,
  error: WsRpcError,
});

export const WsAutomationResolveProposalRpc = Rpc.make(WS_METHODS.automationResolveProposal, {
  payload: AutomationResolveProposalInput,
  success: AutomationResolveProposalResult,
  error: WsRpcError,
});

export const WsSubscribeAutomationEventsRpc = Rpc.make(WS_METHODS.subscribeAutomationEvents, {
  payload: Schema.Struct({}),
  success: AutomationStreamEvent,
  error: WsRpcError,
  stream: true,
});
