import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CWD_REFRESH_INTERVAL_MS, createCwdRefreshThrottle } from "./-cwdRefreshThrottle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCwdRefreshThrottle", () => {
  it("refreshes each cwd at once, then once more after its last burst", () => {
    const refreshed: string[] = [];
    const throttle = createCwdRefreshThrottle((cwd) => refreshed.push(cwd));

    throttle.refresh(["/a"]);
    throttle.refresh(["/a", "/b"]);
    throttle.refresh(["/a"]);
    expect(refreshed).toEqual(["/a", "/b"]);

    vi.advanceTimersByTime(CWD_REFRESH_INTERVAL_MS);
    expect(refreshed).toEqual(["/a", "/b", "/a"]);

    vi.advanceTimersByTime(CWD_REFRESH_INTERVAL_MS * 2);
    throttle.refresh(["/b"]);
    expect(refreshed).toEqual(["/a", "/b", "/a", "/b"]);
  });

  it("drops pending trailing refreshes on cancel", () => {
    const refreshed: string[] = [];
    const throttle = createCwdRefreshThrottle((cwd) => refreshed.push(cwd));

    throttle.refresh(["/a"]);
    throttle.refresh(["/a"]);
    throttle.cancel();
    vi.advanceTimersByTime(CWD_REFRESH_INTERVAL_MS * 2);
    expect(refreshed).toEqual(["/a"]);
  });
});
