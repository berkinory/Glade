import { describe, expect, it } from "vitest";

import {
  isTrustedMediaPermissionRequest,
  shouldAllowMediaPermissionRequest,
} from "./mediaPermissions";

describe("shouldAllowMediaPermissionRequest", () => {
  it.each([
    [{}, true],
    [{ mediaTypes: ["audio"] }, true],
    [{ mediaTypes: ["video"] }, false],
    [{ mediaTypes: ["audio", "video"] }, false],
    [{ mediaType: "audio" }, true],
    [{ mediaType: "video" }, false],
    [{ mediaType: "unknown" }, false],
  ] as const)("allows only audio capture for %o: %s", (details, allowed) => {
    expect(shouldAllowMediaPermissionRequest(details)).toBe(allowed);
  });
});

describe("isTrustedMediaPermissionRequest", () => {
  const requester = (destroyed = false) => ({ isDestroyed: () => destroyed });

  it("allows microphone capture only from the exact trusted live renderer", () => {
    const trusted = requester();

    expect(isTrustedMediaPermissionRequest(trusted, trusted, { mediaTypes: ["audio"] })).toBe(true);
    expect(isTrustedMediaPermissionRequest(requester(), trusted, { mediaTypes: ["audio"] })).toBe(
      false,
    );
    expect(isTrustedMediaPermissionRequest(null, trusted, { mediaTypes: ["audio"] })).toBe(false);
  });

  it("rejects destroyed renderers and browser content without a trusted renderer", () => {
    const destroyed = requester(true);

    expect(isTrustedMediaPermissionRequest(destroyed, destroyed, { mediaTypes: ["audio"] })).toBe(
      false,
    );
    expect(isTrustedMediaPermissionRequest(requester(), null, { mediaTypes: ["audio"] })).toBe(
      false,
    );
  });

  it("rejects subframes and origins other than the live Glade renderer", () => {
    const trusted = {
      isDestroyed: () => false,
      getURL: () => "glade://app/index.html",
    };

    expect(
      isTrustedMediaPermissionRequest(trusted, trusted, {
        mediaTypes: ["audio"],
        isMainFrame: true,
        requestingUrl: "glade://app/chat",
      }),
    ).toBe(true);
    expect(
      isTrustedMediaPermissionRequest(trusted, trusted, {
        mediaTypes: ["audio"],
        isMainFrame: false,
        requestingUrl: "https://untrusted.example/embed",
      }),
    ).toBe(false);
    expect(
      isTrustedMediaPermissionRequest(trusted, trusted, {
        mediaTypes: ["audio"],
        isMainFrame: true,
        requestingUrl: "https://untrusted.example/",
      }),
    ).toBe(false);
    expect(
      isTrustedMediaPermissionRequest(
        trusted,
        trusted,
        { mediaType: "audio", isMainFrame: true },
        "https://untrusted.example",
      ),
    ).toBe(false);
  });
});
