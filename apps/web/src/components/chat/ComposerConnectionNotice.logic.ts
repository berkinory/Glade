import { APP_BASE_NAME } from "~/branding";
import type { ConnectionStatusSnapshot } from "~/connectionStatus";
import type { WsTransportState } from "~/wsTransportEvents";

export interface ConnectionNotice {
  readonly kind:
    | "reconnecting"
    | "unresponsive"
    | "thread-paused"
    | "workspace-paused"
    | "slow"
    | "recovered";
  readonly message: string;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// The single priority order for connection and server-busy notices above the composer. A
// connection that is down outranks a server that is slow; a paused stream needs an action, so it
// outranks passive waiting. Incompatible servers get the full-screen view instead.
export function resolveConnectionNotice(input: {
  readonly transportState: WsTransportState | null;
  readonly reconnectNoticeDue: boolean;
  readonly status: ConnectionStatusSnapshot;
  readonly threadUpdatesPaused: boolean;
}): ConnectionNotice | null {
  const { status } = input;
  if (input.transportState === "connecting" || input.transportState === "closed") {
    return input.reconnectNoticeDue
      ? { kind: "reconnecting", message: `Reconnecting to ${APP_BASE_NAME}…` }
      : null;
  }
  if (input.transportState !== "open") return null;
  if (status.serverUnresponsive) {
    return {
      kind: "unresponsive",
      message: `${APP_BASE_NAME} is not responding yet. It may be busy; updates resume when it answers.`,
    };
  }
  if (input.threadUpdatesPaused) {
    return {
      kind: "thread-paused",
      message: "Updates for this chat paused after repeated retries.",
    };
  }
  if (status.shellStreamPaused) {
    return {
      kind: "workspace-paused",
      message: "Workspace updates paused after repeated retries.",
    };
  }
  if (status.slowRequests > 0) {
    return {
      kind: "slow",
      message:
        status.slowRequests === 1
          ? "A request is taking longer than usual."
          : `${status.slowRequests} requests are taking longer than usual.`,
    };
  }
  if (status.recoveredStallMs !== null) {
    return {
      kind: "recovered",
      message: `${APP_BASE_NAME} was busy for ${seconds(status.recoveredStallMs)} and is responding again.`,
    };
  }
  return null;
}
