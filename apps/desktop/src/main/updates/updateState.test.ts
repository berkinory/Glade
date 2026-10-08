import { describe, expect, it } from "vitest";
import {
  getAutoUpdateDisabledReason,
  hasDownloadProgressAdvanced,
  isExpectedStalledDownloadCancellationError,
  isUpdateVersionAllowedForFlavor,
  isUpdateVersionNewer,
} from "./updateState";

describe("isExpectedStalledDownloadCancellationError", () => {
  it("suppresses the cancellation emitted after a stalled download is cancelled", () => {
    expect(
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: true,
        errorContext: "download",
        message: " cancelled ",
      }),
    ).toBe(true);
  });

  it("does not suppress unrelated updater errors", () => {
    expect(
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: false,
        errorContext: "download",
        message: "cancelled",
      }),
    ).toBe(false);
    expect(
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: true,
        errorContext: "download",
        message: "network timeout",
      }),
    ).toBe(false);
    expect(
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: true,
        errorContext: "check",
        message: "cancelled",
      }),
    ).toBe(false);
  });
});

describe("hasDownloadProgressAdvanced", () => {
  it.each([
    {
      name: "first sample",
      previous: null,
      next: { percent: 10, transferred: 1_024 },
      advanced: true,
    },
    { name: "malformed sample", previous: null, next: {}, advanced: false },
    {
      name: "new bytes in the same percent bucket",
      previous: { percent: 40.1, transferred: 10_000 },
      next: { percent: 40.1, transferred: 12_000 },
      advanced: true,
    },
    {
      name: "duplicate sample",
      previous: { percent: 60, transferred: 20_000 },
      next: { percent: 60, transferred: 20_000 },
      advanced: false,
    },
    {
      name: "percent without byte counts",
      previous: { percent: 60 },
      next: { percent: 61 },
      advanced: true,
    },
    {
      name: "unchanged percent without byte counts",
      previous: { percent: 60 },
      next: { percent: 60 },
      advanced: false,
    },
    {
      name: "new percent with unchanged bytes",
      previous: { percent: 60, transferred: 20_000 },
      next: { percent: 61, transferred: 20_000 },
      advanced: true,
    },
  ])("recognizes $name", ({ previous, next, advanced }) => {
    expect(hasDownloadProgressAdvanced(previous, next)).toBe(advanced);
  });
});

describe("isUpdateVersionNewer", () => {
  it("rejects same-version updates from stale updater cache", () => {
    expect(isUpdateVersionNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isUpdateVersionNewer("0.1.0", "v0.1.0")).toBe(false);
  });

  it("allows newer stable versions and stable releases replacing matching prereleases", () => {
    expect(isUpdateVersionNewer("0.1.0", "0.1.1")).toBe(true);
    expect(isUpdateVersionNewer("0.1.0-beta.1", "0.1.0")).toBe(true);
  });

  it("rejects older versions", () => {
    expect(isUpdateVersionNewer("0.1.1", "0.1.0")).toBe(false);
    expect(isUpdateVersionNewer("1.0.0", "0.9.9")).toBe(false);
  });

  it("orders prereleases within the same base version", () => {
    expect(isUpdateVersionNewer("0.1.0-beta.1", "0.1.0-beta.2")).toBe(true);
    expect(isUpdateVersionNewer("0.1.0-beta.2", "0.1.0-beta.1")).toBe(false);
    expect(isUpdateVersionNewer("0.1.0-beta.1", "0.1.0-beta.1")).toBe(false);
    expect(isUpdateVersionNewer("0.1.0-beta.1", "0.1.0-beta.1.1")).toBe(true);

    expect(isUpdateVersionNewer("0.1.0-beta.2", "0.1.0-beta.10")).toBe(true);

    expect(isUpdateVersionNewer("0.1.0-beta.1", "0.1.0-alpha.9")).toBe(false);
  });
});

describe("isUpdateVersionAllowedForFlavor", () => {
  it("lets production installs accept only stable releases", () => {
    expect(isUpdateVersionAllowedForFlavor("0.8.4", "production")).toBe(true);
    expect(isUpdateVersionAllowedForFlavor("0.8.4-beta.1", "production")).toBe(false);
    expect(isUpdateVersionAllowedForFlavor("v0.8.4-alpha.9", "production")).toBe(false);
  });
});

describe("getAutoUpdateDisabledReason", () => {
  const packagedMac = {
    isDevelopment: false,
    isPackaged: true,
    platform: "darwin",
    appImage: undefined,
    disabledByEnv: false,
    hasUpdateFeedConfig: true,
  } as const;

  it.each([
    {
      name: "development builds",
      overrides: { isDevelopment: true, isPackaged: false },
      reason: "packaged production builds",
    },
    {
      name: "packaged builds without an update feed",
      overrides: { hasUpdateFeedConfig: false },
      reason: "no update feed",
    },
    {
      name: "env-disabled auto updates",
      overrides: { disabledByEnv: true },
      reason: "GLADE_DISABLE_AUTO_UPDATE",
    },
    { name: "linux non-AppImage builds", overrides: { platform: "linux" }, reason: "AppImage" },
  ] as const)("reports $name as disabled", ({ overrides, reason }) => {
    expect(getAutoUpdateDisabledReason({ ...packagedMac, ...overrides })).toContain(reason);
  });

  it("allows packaged builds when an update feed is configured", () => {
    expect(getAutoUpdateDisabledReason(packagedMac)).toBeNull();
  });
});
