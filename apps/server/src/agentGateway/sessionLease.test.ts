import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  acquireAgentGatewaySessionLease,
  AGENT_GATEWAY_NO_CAPABILITIES,
  withAgentGatewayTurnCancellation,
  type AgentGatewaySessionLease,
} from "./sessionLease.ts";

class InjectedFailure extends Error {
  readonly _tag = "InjectedFailure";
}

const connection = { url: "http://127.0.0.1:48123/mcp", bearerToken: "gateway-token" };
const threadId = ThreadId.makeUnsafe("thread-1");

const acquireLease = (credentials: Parameters<typeof acquireAgentGatewaySessionLease>[0]) =>
  acquireAgentGatewaySessionLease(credentials, threadId, "codex", AGENT_GATEWAY_NO_CAPABILITIES);

const makeFakeLease = (overrides: Partial<AgentGatewaySessionLease> = {}) => ({
  connection,
  cancelTurn: vi.fn((_turnId: string) => Promise.resolve()),
  retireTurn: vi.fn((_turnId: string) => Promise.resolve()),
  release: vi.fn(),
  ...overrides,
});

const deferredBarrier = () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { barrier, release };
};

describe("AgentGatewaySessionLease", () => {
  it("cancels one exact turn while the provider session lease is live", async () => {
    const cancelSessionTurnRequests = vi.fn(() => Promise.resolve());
    const lease = acquireLease({
      connectionForThread: () => connection,
      cancelSessionTurnRequests,
      revokeSessionToken: vi.fn(),
    });

    await lease?.cancelTurn("turn-exact");
    expect(cancelSessionTurnRequests).toHaveBeenCalledOnce();
    expect(cancelSessionTurnRequests).toHaveBeenCalledWith("gateway-token", "turn-exact");

    lease?.release();
    await lease?.cancelTurn("turn-too-late");
    expect(cancelSessionTurnRequests).toHaveBeenCalledOnce();
  });

  it("retires terminal write authority without revoking the runtime until release", async () => {
    const retireSessionTurn = vi.fn(() => Promise.resolve());
    const revokeSessionToken = vi.fn();
    const lease = acquireLease({
      connectionForThread: () => connection,
      retireSessionTurn,
      revokeSessionToken,
    });

    await lease?.retireTurn("turn-a");
    expect(retireSessionTurn).toHaveBeenCalledWith("gateway-token", "turn-a");
    expect(revokeSessionToken).not.toHaveBeenCalled();

    lease?.release();
    await lease?.retireTurn("turn-too-late");
    expect(retireSessionTurn).toHaveBeenCalledOnce();
    expect(revokeSessionToken).toHaveBeenCalledWith("gateway-token");
  });

  it("starts provider and gateway interruption concurrently and waits for the gateway barrier", async () => {
    const gateway = deferredBarrier();
    const providerStarted = vi.fn();
    const lease = makeFakeLease({ cancelTurn: vi.fn(() => gateway.barrier) });

    let settled = false;
    const interruption = Effect.runPromise(
      withAgentGatewayTurnCancellation(
        lease,
        "turn-exact",
        Effect.sync(() => providerStarted()),
      ),
    ).then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(providerStarted).toHaveBeenCalledOnce();
      expect(lease.cancelTurn).toHaveBeenCalledWith("turn-exact");
    });
    expect(settled).toBe(false);

    gateway.release();
    await interruption;
    expect(settled).toBe(true);
  });

  it("tombstones the turn and revokes its bearer before the provider interrupt starts", async () => {
    let released = false;
    const cancellationObservedReleasedState: boolean[] = [];
    const lease = makeFakeLease({
      cancelTurn: vi.fn(() => {
        cancellationObservedReleasedState.push(released);
        return Promise.resolve();
      }),
      release: vi.fn(() => {
        released = true;
      }),
    });

    await Effect.runPromise(
      withAgentGatewayTurnCancellation(
        lease,
        "turn-exact",
        Effect.sync(() => expect(released).toBe(true)),
      ),
    );

    expect(cancellationObservedReleasedState).toEqual([false]);
    expect(released).toBe(true);
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("revokes the session before stopping a background child without a parent turn id", async () => {
    let released = false;
    const providerInterrupted = vi.fn();
    const lease = makeFakeLease({
      release: vi.fn(() => {
        released = true;
      }),
    });

    await Effect.runPromise(
      withAgentGatewayTurnCancellation(
        lease,
        undefined,
        Effect.sync(() => {
          expect(released).toBe(true);
          providerInterrupted();
        }),
      ),
    );

    expect(lease.cancelTurn).not.toHaveBeenCalled();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(providerInterrupted).toHaveBeenCalledOnce();
  });

  it("still interrupts the provider but fails closed when bearer revocation fails", async () => {
    const providerInterrupted = vi.fn();
    const lease = makeFakeLease({
      release: vi.fn(() => {
        throw new Error("credential revocation failed");
      }),
    });

    await expect(
      Effect.runPromise(
        withAgentGatewayTurnCancellation(
          lease,
          "turn-exact",
          Effect.sync(() => providerInterrupted()),
        ),
      ),
    ).rejects.toThrow("credential revocation failed");
    expect(providerInterrupted).toHaveBeenCalledOnce();
  });

  it("preserves a provider interruption failure after the gateway barrier settles", async () => {
    const gateway = deferredBarrier();
    const lease = makeFakeLease({ cancelTurn: vi.fn(() => gateway.barrier) });

    let settled = false;
    const interruption = Effect.runPromise(
      withAgentGatewayTurnCancellation(
        lease,
        "turn-exact",
        Effect.fail(new InjectedFailure("provider stop failed")),
      ),
    ).catch((error: unknown) => {
      settled = true;
      throw error;
    });

    await vi.waitFor(() => expect(lease.cancelTurn).toHaveBeenCalledWith("turn-exact"));
    expect(settled).toBe(false);
    gateway.release();
    await expect(interruption).rejects.toThrow("provider stop failed");
  });

  it("acquires one scoped connection and revokes it at most once", () => {
    const connectionForThread = vi.fn(() => connection);
    const revokeSessionToken = vi.fn();

    const lease = acquireLease({ connectionForThread, revokeSessionToken });

    expect(lease?.connection).toEqual(connection);
    expect(connectionForThread).toHaveBeenCalledOnce();
    expect(connectionForThread).toHaveBeenCalledWith("thread-1", "codex");

    lease?.release();
    lease?.release();

    expect(revokeSessionToken).toHaveBeenCalledOnce();
    expect(revokeSessionToken).toHaveBeenCalledWith("gateway-token");
  });

  it("marks the lease released before delegating to a throwing revoker", () => {
    const revokeSessionToken = vi.fn(() => {
      throw new Error("revoke failed");
    });
    const lease = acquireAgentGatewaySessionLease(
      { connectionForThread: () => connection, revokeSessionToken },
      threadId,
      "claudeAgent",
      AGENT_GATEWAY_NO_CAPABILITIES,
    );

    expect(() => lease?.release()).toThrow("revoke failed");
    expect(() => lease?.release()).not.toThrow();
    expect(revokeSessionToken).toHaveBeenCalledOnce();
  });
});
