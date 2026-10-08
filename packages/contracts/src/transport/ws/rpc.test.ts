import { describe, expect, it } from "vitest";

import { WsBootstrapRpcGroup } from "./bootstrapRpc";
import { WsFeatureRpcGroup } from "./rpc";

describe("WS RPC contracts", () => {
  it("keeps bootstrap and feature RPCs in separate groups", () => {
    expect(WsBootstrapRpcGroup.requests.has("bootstrap.negotiate")).toBe(true);
    expect(WsFeatureRpcGroup.requests.has("bootstrap.negotiate")).toBe(false);
  });
});
