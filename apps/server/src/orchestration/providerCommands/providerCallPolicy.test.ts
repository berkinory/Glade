import { describe, it, expect } from "vitest";
import {
  classifyProviderAttemptOutcome,
  isSafeLegacyProviderBlocker,
} from "./providerCallPolicy.ts";
import { Exit } from "effect";
import { ProviderAdapterProcessError } from "../../provider/core/Errors.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";

describe("legacy provider blocker recovery", () => {
  it("rejects a startup failure only when process cleanup was confirmed", () => {
    const outcome = classifyProviderAttemptOutcome(
      Exit.fail(
        new ProviderAdapterProcessError({
          provider: "codex",
          threadId: ThreadId.makeUnsafe("thread-start-failed"),
          reason: "startup-failed",
          detail: "Codex stdout closed during initialization.",
        }),
      ),
    );
    expect(outcome._tag).toBe("rejected");
  });

  it("keeps process lifecycle failures uncertain", () => {
    const outcome = classifyProviderAttemptOutcome(
      Exit.fail(
        new ProviderAdapterProcessError({
          provider: "claudeAgent",
          threadId: ThreadId.makeUnsafe("thread-exit-unproven"),
          detail: "Provider process tree did not prove exit (rootExited=false).",
        }),
      ),
    );

    expect(outcome._tag).toBe("uncertain");
  });

  it("accepts only failures that prove the provider command was not executed", () => {
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree 66212 did not prove exit (rootExited=true, captureComplete=false; no captured descendants remain).",
      ),
    ).toBe(false);
    expect(
      isSafeLegacyProviderBlocker("Codex app-server stdin closed before the frame was written."),
    ).toBe(true);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider adapter request failed (codex) for thread/rollback: Invalid request: unknown variant `thread/rollback`",
      ),
    ).toBe(true);
    expect(isSafeLegacyProviderBlocker("thread/rollback timed out after send")).toBe(false);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree did not prove exit (rootExited=false, captureComplete=true).",
      ),
    ).toBe(false);
    expect(
      isSafeLegacyProviderBlocker(
        "Provider process tree did not prove exit (rootExited=true, captureComplete=false; captured descendants remain).",
      ),
    ).toBe(false);
    expect(isSafeLegacyProviderBlocker("Provider process tree did not prove exit.")).toBe(false);
    expect(isSafeLegacyProviderBlocker("Session stopped before request completed.")).toBe(false);
    expect(isSafeLegacyProviderBlocker("The provider rejected the prompt.")).toBe(false);
  });
});
