import { describe, it, assert } from "@effect/vitest";

import {
  CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS,
  createClaudeCredentialKeepaliveController,
  isClaudeCredentialKeepaliveEnabled,
  resolveClaudeCredentialKeepaliveIntervalMs,
  startClaudeCredentialKeepalive,
} from "./claudeCredentialKeepalive.ts";

describe("claudeCredentialKeepalive", () => {
  it("requires explicit opt-in on macOS", () => {
    assert.equal(isClaudeCredentialKeepaliveEnabled({ platform: "darwin", env: {} }), false);
    assert.equal(
      isClaudeCredentialKeepaliveEnabled({
        platform: "darwin",
        env: { GLADE_CLAUDE_KEEPALIVE: "1" },
      }),
      true,
    );
    assert.equal(
      isClaudeCredentialKeepaliveEnabled({
        platform: "linux",
        env: { GLADE_CLAUDE_KEEPALIVE: "1" },
      }),
      false,
    );
  });

  it.each([
    ["60", 60 * 60 * 1000],
    ["999999999", CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS],
    ["0", 30 * 60 * 1000],
    [undefined, 30 * 60 * 1000],
  ] as const)("resolves a keepalive interval of %s minutes to %i ms", (minutes, expected) => {
    assert.equal(
      resolveClaudeCredentialKeepaliveIntervalMs(
        minutes === undefined ? {} : { GLADE_CLAUDE_KEEPALIVE_MINUTES: minutes },
      ),
      expected,
    );
  });

  it("stops and restarts the keepalive as Claude is disabled and re-enabled", async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const controller = createClaudeCredentialKeepaliveController({
      start: (input) => {
        const binaryPath = input?.binaryPath ?? "claude";
        started.push(binaryPath);
        return {
          stop: async () => {
            stopped.push(binaryPath);
          },
        };
      },
    });

    await controller.reconcile({ enabled: true, binaryPath: "/one/claude" });
    await controller.reconcile({ enabled: true, binaryPath: "/one/claude" });
    await controller.reconcile({ enabled: false, binaryPath: "/one/claude" });
    await controller.reconcile({ enabled: true, binaryPath: "/two/claude" });
    await controller.stop();

    assert.deepEqual(started, ["/one/claude", "/two/claude"]);
    assert.deepEqual(stopped, ["/one/claude", "/two/claude"]);
  });

  it("aborts and waits for an in-flight auth probe when stopped", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let aborted = false;
    let settled = false;
    const handle = startClaudeCredentialKeepalive({
      platform: "darwin",
      env: { GLADE_CLAUDE_KEEPALIVE: "1" },
      runAuthStatus: ({ signal }) =>
        new Promise<void>((resolve) => {
          markStarted();
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              setTimeout(() => {
                settled = true;
                resolve();
              }, 0);
            },
            { once: true },
          );
        }),
    });

    await started;
    const stopping = handle.stop();

    assert.equal(aborted, true);
    assert.equal(settled, false);
    await stopping;
    assert.equal(settled, true);
  });
});
