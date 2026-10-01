import * as Rpc from "effect/unstable/rpc/Rpc";
import {
  COMPUTER_WS_METHODS,
  ComputerGetStatusInput,
  ComputerStatusResult,
  ComputerProvisionInput,
  ComputerProvisionResult,
  ComputerListWindowsInput,
  ComputerListWindowsResult,
  ComputerGetStateInput,
  ComputerState,
  ComputerGetScreenSizeInput,
  ComputerGetScreenSizeResult,
  ComputerLaunchAppInput,
  ComputerLaunchAppResult,
  ComputerClickInput,
  ComputerActionResult,
  ComputerDoubleClickInput,
  ComputerRightClickInput,
  ComputerMoveCursorInput,
  ComputerDragInput,
  ComputerScrollInput,
  ComputerTypeTextInput,
  ComputerPressKeyInput,
  ComputerHotkeyInput,
  ComputerSetValueInput,
  ComputerPerformActionInput,
  ComputerSelectTextInput,
  ComputerSetControlEnabledInput,
  ComputerControlEnabledResult,
  ComputerThreadInput,
  ThreadComputerState,
  ComputerInputClickInput,
  ComputerInputScrollInput,
  ComputerInputKeyInput,
  ComputerEvent,
} from "../../computer/computer";
import {
  ComputerGetAuditHistoryInput,
  ComputerGetAuditHistoryResult,
} from "../../computer/computerAudit";
import { Schema } from "effect";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { WsRpcError } from "./rpcErrors";

export const WsComputerGetStatusRpc = Rpc.make(COMPUTER_WS_METHODS.getStatus, {
  payload: ComputerGetStatusInput,
  success: ComputerStatusResult,
  error: WsRpcError,
});

export const WsComputerGetAuditHistoryRpc = Rpc.make(COMPUTER_WS_METHODS.getAuditHistory, {
  payload: ComputerGetAuditHistoryInput,
  success: ComputerGetAuditHistoryResult,
  error: WsRpcError,
});

export const WsComputerProvisionRpc = Rpc.make(COMPUTER_WS_METHODS.provision, {
  payload: ComputerProvisionInput,
  success: ComputerProvisionResult,
  error: WsRpcError,
});

export const WsComputerListWindowsRpc = Rpc.make(COMPUTER_WS_METHODS.listWindows, {
  payload: ComputerListWindowsInput,
  success: ComputerListWindowsResult,
  error: WsRpcError,
});

export const WsComputerGetStateRpc = Rpc.make(COMPUTER_WS_METHODS.getState, {
  payload: ComputerGetStateInput,
  success: ComputerState,
  error: WsRpcError,
});

export const WsComputerGetScreenSizeRpc = Rpc.make(COMPUTER_WS_METHODS.getScreenSize, {
  payload: ComputerGetScreenSizeInput,
  success: ComputerGetScreenSizeResult,
  error: WsRpcError,
});

export const WsComputerLaunchAppRpc = Rpc.make(COMPUTER_WS_METHODS.launchApp, {
  payload: ComputerLaunchAppInput,
  success: ComputerLaunchAppResult,
  error: WsRpcError,
});

export const WsComputerClickRpc = Rpc.make(COMPUTER_WS_METHODS.click, {
  payload: ComputerClickInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerDoubleClickRpc = Rpc.make(COMPUTER_WS_METHODS.doubleClick, {
  payload: ComputerDoubleClickInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerRightClickRpc = Rpc.make(COMPUTER_WS_METHODS.rightClick, {
  payload: ComputerRightClickInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerMoveCursorRpc = Rpc.make(COMPUTER_WS_METHODS.moveCursor, {
  payload: ComputerMoveCursorInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerDragRpc = Rpc.make(COMPUTER_WS_METHODS.drag, {
  payload: ComputerDragInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerScrollRpc = Rpc.make(COMPUTER_WS_METHODS.scroll, {
  payload: ComputerScrollInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerTypeTextRpc = Rpc.make(COMPUTER_WS_METHODS.typeText, {
  payload: ComputerTypeTextInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerPressKeyRpc = Rpc.make(COMPUTER_WS_METHODS.pressKey, {
  payload: ComputerPressKeyInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerHotkeyRpc = Rpc.make(COMPUTER_WS_METHODS.hotkey, {
  payload: ComputerHotkeyInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerSetValueRpc = Rpc.make(COMPUTER_WS_METHODS.setValue, {
  payload: ComputerSetValueInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerPerformActionRpc = Rpc.make(COMPUTER_WS_METHODS.performAction, {
  payload: ComputerPerformActionInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerSelectTextRpc = Rpc.make(COMPUTER_WS_METHODS.selectText, {
  payload: ComputerSelectTextInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerSetControlEnabledRpc = Rpc.make(COMPUTER_WS_METHODS.setControlEnabled, {
  payload: ComputerSetControlEnabledInput,
  success: ComputerControlEnabledResult,
  error: WsRpcError,
});

export const WsComputerGetThreadStateRpc = Rpc.make(COMPUTER_WS_METHODS.getThreadState, {
  payload: ComputerThreadInput,
  success: ThreadComputerState,
  error: WsRpcError,
});

export const WsComputerInputClickRpc = Rpc.make(COMPUTER_WS_METHODS.inputClick, {
  payload: ComputerInputClickInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerInputScrollRpc = Rpc.make(COMPUTER_WS_METHODS.inputScroll, {
  payload: ComputerInputScrollInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsComputerInputKeyRpc = Rpc.make(COMPUTER_WS_METHODS.inputKey, {
  payload: ComputerInputKeyInput,
  success: ComputerActionResult,
  error: WsRpcError,
});

export const WsSubscribeComputerEventsRpc = Rpc.make(COMPUTER_WS_METHODS.subscribeEvents, {
  payload: Schema.Struct({}),
  success: ComputerEvent,
  error: WsRpcError,
  stream: true,
});

export const WsComputerRpcGroup = RpcGroup.make(
  WsComputerGetStatusRpc,
  WsComputerGetAuditHistoryRpc,
  WsComputerProvisionRpc,
  WsComputerListWindowsRpc,
  WsComputerGetStateRpc,
  WsComputerGetScreenSizeRpc,
  WsComputerLaunchAppRpc,
  WsComputerClickRpc,
  WsComputerDoubleClickRpc,
  WsComputerRightClickRpc,
  WsComputerMoveCursorRpc,
  WsComputerDragRpc,
  WsComputerScrollRpc,
  WsComputerTypeTextRpc,
  WsComputerPressKeyRpc,
  WsComputerHotkeyRpc,
  WsComputerSetValueRpc,
  WsComputerPerformActionRpc,
  WsComputerSelectTextRpc,
  WsComputerGetThreadStateRpc,
  WsComputerSetControlEnabledRpc,
  WsComputerInputClickRpc,
  WsComputerInputScrollRpc,
  WsComputerInputKeyRpc,
  WsSubscribeComputerEventsRpc,
);
