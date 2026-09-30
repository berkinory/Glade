import { describe, expect, it, vi } from "vitest";
import { AutomationSessionRegistry } from "./automationSessionAffinity";
import { BrowserAutomationHostError } from "./hostErrors";
import type { SessionAffinity } from "./automationHostPolicy";
import { ThreadId } from "@glade/contracts/core/baseSchemas";

const affinity: SessionAffinity = {
  provider: "codex",
  threadId: ThreadId.makeUnsafe("thread-1"),
  tabId: null,
};

describe("browser automation idempotency", () => {
  it("runs a repeated intention once and rejects a conflicting intention", async () => {
    const registry = new AutomationSessionRegistry();
    const run = vi.fn(async () => ({ ok: true }));

    const first = registry.runIdempotent("session:key", "same", true, affinity, run);
    const repeated = registry.runIdempotent("session:key", "same", true, affinity, run);

    expect(await first).toEqual({ ok: true });
    expect(await repeated).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(() => registry.runIdempotent("session:key", "different", true, affinity, run)).toThrow(
      BrowserAutomationHostError,
    );
  });

  it("allows a retry after a confirmed pre-effect failure", async () => {
    const registry = new AutomationSessionRegistry();
    const failure = new BrowserAutomationHostError({
      code: "BrowserCancelled",
      retryable: true,
      phase: "runtime",
      effectMayHaveCommitted: false,
    });
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ ok: true });

    await expect(registry.runIdempotent("session:key", "same", true, affinity, run)).rejects.toBe(
      failure,
    );
    await expect(
      registry.runIdempotent("session:key", "same", true, affinity, run),
    ).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
