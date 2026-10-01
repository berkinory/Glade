import * as Rpc from "effect/unstable/rpc/Rpc";
import {
  ORCHESTRATION_WS_METHODS,
  OrchestrationRpcSchemas,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
} from "../../orchestration/rpc";
import { ClientOrchestrationCommand } from "../../orchestration/commands";
import {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "../../orchestration/snapshots";
import { Schema } from "effect";
import { WS_METHODS } from "./ws";
import { OrchestrationEvent } from "../../orchestration/events";
import { WsRpcError } from "./rpcErrors";

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationImportThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.importThread, {
  payload: OrchestrationImportThreadInput,
  success: OrchestrationImportThreadResult,
  error: WsRpcError,
});

export const WsListProjectImportsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.listProjectImports, {
  payload: OrchestrationRpcSchemas.listProjectImports.input,
  success: OrchestrationRpcSchemas.listProjectImports.output,
  error: WsRpcError,
});

export const WsImportProjectRpc = Rpc.make(ORCHESTRATION_WS_METHODS.importProject, {
  payload: OrchestrationRpcSchemas.importProject.input,
  success: OrchestrationRpcSchemas.importProject.output,
  error: WsRpcError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationRpcSchemas.getSnapshot.input,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: WsRpcError,
});

export const WsOrchestrationGetShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getShellSnapshot.input,
    success: OrchestrationRpcSchemas.getShellSnapshot.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationRepairStateRpc = Rpc.make(ORCHESTRATION_WS_METHODS.repairState, {
  payload: OrchestrationRpcSchemas.repairState.input,
  success: OrchestrationRpcSchemas.repairState.output,
  error: WsRpcError,
});

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationRpcSchemas.getTurnDiff.input,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: WsRpcError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationRpcSchemas.getFullThreadDiff.input,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationGetThreadDetailSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot,
  {
    payload: OrchestrationRpcSchemas.getThreadDetailSnapshot.input,
    success: OrchestrationRpcSchemas.getThreadDetailSnapshot.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationRpcSchemas.replayEvents.input,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: WsRpcError,
});

export const WsOrchestrationListProviderDeliveryBlockersRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers,
  {
    payload: OrchestrationRpcSchemas.listProviderDeliveryBlockers.input,
    success: OrchestrationRpcSchemas.listProviderDeliveryBlockers.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationReconcileProviderDeliveryRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.reconcileProviderDelivery,
  {
    payload: OrchestrationRpcSchemas.reconcileProviderDelivery.input,
    success: OrchestrationRpcSchemas.reconcileProviderDelivery.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationPrepareQuitResumeRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.prepareQuitResume,
  {
    payload: OrchestrationRpcSchemas.prepareQuitResume.input,
    success: OrchestrationRpcSchemas.prepareQuitResume.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationShellStreamItem,
  error: WsRpcError,
  stream: true,
});

export const WsOrchestrationUnsubscribeShellRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeShell,
  {
    payload: OrchestrationRpcSchemas.unsubscribeShell.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationThreadStreamItem,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationSubscribeDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationUnsubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeThread,
  {
    payload: OrchestrationRpcSchemas.unsubscribeThread.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsPreviewWorkspaceRestoreRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.previewWorkspaceRestore,
  {
    payload: OrchestrationRpcSchemas.previewWorkspaceRestore.input,
    success: OrchestrationRpcSchemas.previewWorkspaceRestore.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationPrepareHandoffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.prepareHandoff, {
  payload: OrchestrationRpcSchemas.prepareHandoff.input,
  success: OrchestrationRpcSchemas.prepareHandoff.output,
  error: WsRpcError,
});
