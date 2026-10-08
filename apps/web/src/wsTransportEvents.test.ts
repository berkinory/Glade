import { describe, expect, it, vi } from "vitest";

import {
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WsCompatibilityError,
} from "@glade/contracts/transport/ws/wsCompatibility";

import {
  addWsCompatibilityIssueListener,
  addWsTransportStateListener,
  emitWsCompatibilityIssue,
  emitWsTransportState,
  readLatestWsCompatibilityIssue,
} from "./wsTransportEvents";

describe("WebSocket transport state events", () => {
  it("replays an already-open transport to a late reconciliation listener", () => {
    emitWsTransportState("open");
    const listener = vi.fn();

    const unsubscribe = addWsTransportStateListener(listener, { replayCurrent: true });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("open");
    unsubscribe();
  });

  it("latches terminal compatibility guidance for late UI subscribers", () => {
    const issue = new WsCompatibilityError({
      message: "Update this client.",
      code: "WS_PROTOCOL_INCOMPATIBLE",
      retryable: false,
      action: "update-client",
      serverBuild: "0.5.2",
      protocolEpoch: WS_PROTOCOL_EPOCH,
      minRevision: WS_PROTOCOL_MIN_REVISION,
      maxRevision: WS_PROTOCOL_MAX_REVISION,
    });
    const listener = vi.fn();

    emitWsCompatibilityIssue(issue);
    const unsubscribe = addWsCompatibilityIssueListener(listener, { replayCurrent: true });

    expect(readLatestWsCompatibilityIssue()).toBe(issue);
    expect(listener).toHaveBeenCalledWith(issue);

    unsubscribe();
    emitWsCompatibilityIssue(null);
  });
});
