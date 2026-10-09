import type { COMPUTER_WS_METHODS, ComputerState } from "@glade/contracts/transport/ws/computerRpc";
import type {
  REMOTE_ACCESS_WS_METHODS,
  RemoteAccessDevices,
  RemoteAccessStatus,
} from "@glade/contracts/transport/ws/remoteAccessRpc";

// Streams without input that always send the whole current state.
export interface StateStreamEvents {
  readonly [COMPUTER_WS_METHODS.subscribe]: ComputerState;
  readonly [REMOTE_ACCESS_WS_METHODS.subscribe]: RemoteAccessStatus;
  readonly [REMOTE_ACCESS_WS_METHODS.subscribeDevices]: RemoteAccessDevices;
}

export type StateStreamMethod = keyof StateStreamEvents;
