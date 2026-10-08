import { describe, expect, it, vi } from "vitest";

import {
  PendingUpdateCacheClearQueue,
  resolveElectronUpdaterCacheDir,
  resolveElectronUpdaterCacheDirName,
  resolveElectronUpdaterLegacyZipPath,
  resolveElectronUpdaterPendingCacheDir,
} from "./updatePendingCache";

describe("resolveElectronUpdaterCacheDirName", () => {
  it("matches electron-updater's cache directory fallback", () => {
    expect(resolveElectronUpdaterCacheDirName(null, "Glade")).toBe("Glade");
    expect(
      resolveElectronUpdaterCacheDirName({ updaterCacheDirName: "Glade-updater" }, "Glade"),
    ).toBe("Glade-updater");
  });
});

describe("resolveElectronUpdaterPendingCacheDir", () => {
  it.each([
    {
      name: "macOS",
      input: { platform: "darwin", homeDir: "/Users/test" },
      expected: "/Users/test/Library/Caches/Glade-updater/pending",
    },
    {
      name: "Windows",
      input: {
        platform: "win32",
        homeDir: "C:\\Users\\test",
        localAppData: "C:\\Users\\test\\AppData\\Local",
      },
      expected: "C:\\Users\\test\\AppData\\Local\\Glade-updater\\pending",
    },
    {
      name: "Windows with an empty cache env var",
      input: { platform: "win32", homeDir: "C:\\Users\\test", localAppData: "" },
      expected: "C:\\Users\\test\\AppData\\Local\\Glade-updater\\pending",
    },
    {
      name: "Linux",
      input: { platform: "linux", homeDir: "/home/test", xdgCacheHome: "/tmp/cache" },
      expected: "/tmp/cache/Glade-updater/pending",
    },
    {
      name: "Linux with an empty cache env var",
      input: { platform: "linux", homeDir: "/home/test", xdgCacheHome: "" },
      expected: "/home/test/.cache/Glade-updater/pending",
    },
  ] as const)("matches electron-updater's pending cache path on $name", ({ input, expected }) => {
    expect(resolveElectronUpdaterPendingCacheDir({ cacheDirName: "Glade-updater", ...input })).toBe(
      expected,
    );
  });

  it("returns null when no cache dir is configured", () => {
    expect(
      resolveElectronUpdaterPendingCacheDir({
        cacheDirName: null,
        platform: "darwin",
        homeDir: "/Users/test",
      }),
    ).toBeNull();
  });
});

describe("resolveElectronUpdaterCacheDir", () => {
  it("exposes the shared cache root and legacy top-level zip path", () => {
    const args = {
      cacheDirName: "Glade-updater",
      platform: "darwin" as const,
      homeDir: "/Users/test",
    };

    expect(resolveElectronUpdaterCacheDir(args)).toBe("/Users/test/Library/Caches/Glade-updater");
    expect(resolveElectronUpdaterLegacyZipPath(args)).toBe(
      "/Users/test/Library/Caches/Glade-updater/update.zip",
    );
  });
});

describe("PendingUpdateCacheClearQueue", () => {
  it("clears immediately when no download is in flight", () => {
    const queue = new PendingUpdateCacheClearQueue();
    const clearNow = vi.fn();

    queue.request("no newer update available", false, clearNow);

    expect(clearNow).toHaveBeenCalledWith("no newer update available");
    expect(queue.consumeAfterDownload()).toBeNull();
  });

  it("defers cleanup while the updater download is still in flight", () => {
    const queue = new PendingUpdateCacheClearQueue();
    const clearNow = vi.fn();

    queue.request("downloaded version is not newer", true, clearNow);

    expect(clearNow).not.toHaveBeenCalled();
    expect(queue.consumeAfterDownload()).toBe("downloaded version is not newer");
    expect(queue.consumeAfterDownload()).toBeNull();
  });

  it("keeps the latest deferred cleanup reason", () => {
    const queue = new PendingUpdateCacheClearQueue();

    queue.request("first stale artifact", true, vi.fn());
    queue.request("latest stale artifact", true, vi.fn());

    expect(queue.consumeAfterDownload()).toBe("latest stale artifact");
  });
});
