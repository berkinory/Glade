import { describe, expect, it } from "vitest";

import { WsBootstrapRpcGroup } from "./bootstrapRpc";
import { WsFeatureRpcGroup } from "./rpc";
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
});
