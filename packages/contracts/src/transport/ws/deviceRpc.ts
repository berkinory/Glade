import * as Rpc from "effect/unstable/rpc/Rpc";
import {
  DEVICE_WS_METHODS,
  DeviceListInput,
  DeviceListResult,
  DeviceBootInput,
  DeviceBootResult,
  DeviceShutdownInput,
  DeviceAttachInput,
  ThreadDeviceState,
  DeviceDetachInput,
  DeviceThreadInput,
  DeviceTapInput,
  DeviceSwipeInput,
  DeviceTypeTextInput,
  DeviceKeyEventInput,
  DevicePressButtonInput,
  DeviceInstallAppInput,
  DeviceInstallAppResult,
  DeviceLaunchAppInput,
  DeviceLaunchAppResult,
  DeviceOpenUrlInput,
  DeviceScreenshotInput,
  DeviceScreenshotResult,
  DeviceStartRecordingInput,
  DeviceStartRecordingResult,
  DeviceStopRecordingInput,
  DeviceStopRecordingResult,
  DeviceDescribeUiInput,
  DeviceDescribeUiResult,
  DeviceScrollToElementInput,
  DeviceScrollToElementResult,
  DeviceEvent,
} from "../../device/device";
import { Schema } from "effect";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { WsRpcError } from "./rpcErrors";

export const WsDeviceListRpc = Rpc.make(DEVICE_WS_METHODS.list, {
  payload: DeviceListInput,
  success: DeviceListResult,
  error: WsRpcError,
});

export const WsDeviceBootRpc = Rpc.make(DEVICE_WS_METHODS.boot, {
  payload: DeviceBootInput,
  success: DeviceBootResult,
  error: WsRpcError,
});

export const WsDeviceShutdownRpc = Rpc.make(DEVICE_WS_METHODS.shutdown, {
  payload: DeviceShutdownInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceAttachRpc = Rpc.make(DEVICE_WS_METHODS.attach, {
  payload: DeviceAttachInput,
  success: ThreadDeviceState,
  error: WsRpcError,
});

export const WsDeviceDetachRpc = Rpc.make(DEVICE_WS_METHODS.detach, {
  payload: DeviceDetachInput,
  success: ThreadDeviceState,
  error: WsRpcError,
});

export const WsDeviceGetThreadStateRpc = Rpc.make(DEVICE_WS_METHODS.getThreadState, {
  payload: DeviceThreadInput,
  success: ThreadDeviceState,
  error: WsRpcError,
});

export const WsDeviceTapRpc = Rpc.make(DEVICE_WS_METHODS.tap, {
  payload: DeviceTapInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceSwipeRpc = Rpc.make(DEVICE_WS_METHODS.swipe, {
  payload: DeviceSwipeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceTypeTextRpc = Rpc.make(DEVICE_WS_METHODS.typeText, {
  payload: DeviceTypeTextInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceKeyEventRpc = Rpc.make(DEVICE_WS_METHODS.keyEvent, {
  payload: DeviceKeyEventInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDevicePressButtonRpc = Rpc.make(DEVICE_WS_METHODS.pressButton, {
  payload: DevicePressButtonInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceInstallAppRpc = Rpc.make(DEVICE_WS_METHODS.installApp, {
  payload: DeviceInstallAppInput,
  success: DeviceInstallAppResult,
  error: WsRpcError,
});

export const WsDeviceLaunchAppRpc = Rpc.make(DEVICE_WS_METHODS.launchApp, {
  payload: DeviceLaunchAppInput,
  success: DeviceLaunchAppResult,
  error: WsRpcError,
});

export const WsDeviceOpenUrlRpc = Rpc.make(DEVICE_WS_METHODS.openUrl, {
  payload: DeviceOpenUrlInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsDeviceScreenshotRpc = Rpc.make(DEVICE_WS_METHODS.screenshot, {
  payload: DeviceScreenshotInput,
  success: DeviceScreenshotResult,
  error: WsRpcError,
});

export const WsDeviceStartRecordingRpc = Rpc.make(DEVICE_WS_METHODS.startRecording, {
  payload: DeviceStartRecordingInput,
  success: DeviceStartRecordingResult,
  error: WsRpcError,
});

export const WsDeviceStopRecordingRpc = Rpc.make(DEVICE_WS_METHODS.stopRecording, {
  payload: DeviceStopRecordingInput,
  success: DeviceStopRecordingResult,
  error: WsRpcError,
});

export const WsDeviceDescribeUiRpc = Rpc.make(DEVICE_WS_METHODS.describeUi, {
  payload: DeviceDescribeUiInput,
  success: DeviceDescribeUiResult,
  error: WsRpcError,
});

export const WsDeviceScrollToElementRpc = Rpc.make(DEVICE_WS_METHODS.scrollToElement, {
  payload: DeviceScrollToElementInput,
  success: DeviceScrollToElementResult,
  error: WsRpcError,
});

export const WsSubscribeDeviceEventsRpc = Rpc.make(DEVICE_WS_METHODS.subscribeEvents, {
  payload: Schema.Struct({}),
  success: DeviceEvent,
  error: WsRpcError,
  stream: true,
});

export const WsDeviceRpcGroup = RpcGroup.make(
  WsDeviceListRpc,
  WsDeviceBootRpc,
  WsDeviceShutdownRpc,
  WsDeviceAttachRpc,
  WsDeviceDetachRpc,
  WsDeviceGetThreadStateRpc,
  WsDeviceTapRpc,
  WsDeviceSwipeRpc,
  WsDeviceTypeTextRpc,
  WsDeviceKeyEventRpc,
  WsDevicePressButtonRpc,
  WsDeviceInstallAppRpc,
  WsDeviceLaunchAppRpc,
  WsDeviceOpenUrlRpc,
  WsDeviceScreenshotRpc,
  WsDeviceStartRecordingRpc,
  WsDeviceStopRecordingRpc,
  WsDeviceDescribeUiRpc,
  WsDeviceScrollToElementRpc,
  WsSubscribeDeviceEventsRpc,
);
