import { describe, expect, it } from "vitest";
import { decodeCodexNotification, decodeCodexServerRequest } from "./decode";

const ids = { threadId: "thr_1", turnId: "turn_1", itemId: "item_1" };

describe("Codex protocol decoding", () => {
  it.each([
    ["item/agentMessage/delta", { ...ids, delta: "hello" }],
    ["error", { ...ids, willRetry: false, error: { message: "boom", codexErrorInfo: null } }],
  ])("accepts a valid %s notification", (method, params) => {
    const notification = { method, params, emittedAtMs: 1 };
    expect(decodeCodexNotification(notification)).toBe("valid");
  });

  it.each([
    ["item/agentMessage/delta", { ...ids, delta: 42 }],
    ["error", { ...ids, willRetry: false, error: {} }],
    ["error", undefined],
  ])("rejects an invalid %s notification", (method, params) => {
    expect(() => decodeCodexNotification({ method, params })).toThrow(
      `Invalid Codex notification payload for ${method}.`,
    );
  });

  it.each([
    ["currentTime/read", { threadId: "thr_1" }, "valid"],
    ["item/fileChange/requestApproval", { ...ids, startedAtMs: 1 }, "valid"],
    ["future/request", { anything: true }, "unknown"],
  ])("decodes a %s server request as %s", (method, params, result) => {
    const request = { id: 7, method, params };
    expect(decodeCodexServerRequest(request)).toBe(result);
  });

  it("rejects a server request whose params do not match its method", () => {
    const request = { id: 7, method: "item/fileChange/requestApproval", params: ids };
    expect(() => decodeCodexServerRequest(request)).toThrow(
      "Invalid Codex request payload for item/fileChange/requestApproval.",
    );
  });

  it("leaves unknown notification methods undecoded", () => {
    expect(decodeCodexNotification({ method: "future/notification", params: 1 })).toBe("unknown");
  });
});
