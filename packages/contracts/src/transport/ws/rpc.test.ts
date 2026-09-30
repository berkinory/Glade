import { describe, expect, it } from "vitest";

import { WsBootstrapRpcGroup } from "./bootstrapRpc";
import { WsFeatureRpcGroup } from "./rpc";
import { WsComputerRpcGroup } from "./computerRpc";
import { COMPUTER_WS_METHODS } from "../../computer/computer";
import { ORCHESTRATION_WS_METHODS } from "../../orchestration/rpc";

describe("WS RPC contracts", () => {
  it("keeps bootstrap and feature RPCs in separate groups", () => {
    expect(WsBootstrapRpcGroup.requests.has("bootstrap.negotiate")).toBe(true);
    expect(WsFeatureRpcGroup.requests.has("bootstrap.negotiate")).toBe(false);
    expect(
      WsFeatureRpcGroup.requests.has(ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers),
    ).toBe(true);
    expect(WsFeatureRpcGroup.requests.has(ORCHESTRATION_WS_METHODS.reconcileProviderDelivery)).toBe(
      true,
    );
  });

  it("registers every computer method, including setup", () => {
    for (const method of Object.values(COMPUTER_WS_METHODS)) {
      expect(WsComputerRpcGroup.requests.has(method)).toBe(true);
    }
  });
});
