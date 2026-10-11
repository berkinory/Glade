import { describe, expect, it } from "vitest";

import { GitHubRateLimits } from "./gitHubRateLimits";

const headers = (values: Record<string, string>) => new Headers(values);

describe("GitHubRateLimits", () => {
  it("keeps the last tenth of the quota for foreground work", () => {
    const limits = new GitHubRateLimits(() => 1_000);
    limits.observe(
      "token",
      "graphql",
      headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "400",
        "x-ratelimit-reset": "3600",
      }),
    );
    expect(limits.admit("token", "graphql", "background")?.reason).toBe("rate-limited");
    expect(limits.admit("token", "graphql", "foreground")).toBeNull();
    expect(limits.admit("token", "core", "background")).toBeNull();
  });

  it("refuses everything once GitHub reports the quota empty, until it resets", () => {
    let now = 1_000;
    const limits = new GitHubRateLimits(() => now);
    limits.observe(
      "token",
      "core",
      headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "60",
      }),
    );
    expect(limits.admit("token", "core", "foreground")?.retryAt).toBe(60_000);
    now = 61_000;
    expect(limits.admit("token", "core", "background")).toBeNull();
  });

  it("pauses background work from retry-after and backs off without it", () => {
    let now = 0;
    const limits = new GitHubRateLimits(() => now);
    expect(limits.pause("token", headers({ "retry-after": "120" })).retryAtMs).toBe(120_000);
    expect(limits.admit("token", "core", "background")?.reason).toBe("rate-limited");
    expect(limits.admit("token", "core", "foreground")).toBeNull();
    now = 200_000;
    expect(limits.pause("token", null).retryAtMs).toBe(200_000 + 60_000);
  });

  it("does not let a success from before a pause clear it", () => {
    let now = 0;
    const limits = new GitHubRateLimits(() => now);
    const staleLease = limits.lease("token");
    limits.pause("token", headers({ "retry-after": "60" }));
    now = 20_000;
    limits.succeeded("token", staleLease);
    expect(limits.admit("token", "core", "background")?.reason).toBe("rate-limited");

    now = 61_000;
    limits.succeeded("token", limits.lease("token"));
    expect(limits.pause("token", null).retryAtMs).toBe(61_000 + 30_000);
  });
});
