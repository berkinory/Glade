import { describe, expect, it } from "vitest";

import type { ServerConfigShape } from "../config";
import {
  isTrustedAppOrigin,
  normalizeCorsOrigin,
  requiresWebSocketAuthentication,
  shouldRejectAuthMutationOrigin,
  shouldRejectUntrustedRequestOrigin,
} from "./trustedOrigins";

const config = {
  devUrl: new URL("http://localhost:5173/"),
} as ServerConfigShape;

describe("trustedOrigins", () => {
  it("trusts same-origin, configured dev, and desktop app origins", () => {
    expect(
      isTrustedAppOrigin({
        origin: "http://127.0.0.1:58090",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
    expect(
      isTrustedAppOrigin({
        origin: "http://localhost:5173",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
    expect(
      isTrustedAppOrigin({
        origin: "glade://app",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
    expect(
      isTrustedAppOrigin({
        origin: "glade-dev://app",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
    expect(
      isTrustedAppOrigin({
        origin: "glade-cua://app",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
    expect(
      isTrustedAppOrigin({
        origin: "glade-beta://app",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
  });

  it("rejects unrelated browser origins but allows non-browser requests without Origin", () => {
    expect(
      isTrustedAppOrigin({
        origin: "https://example.test",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
    expect(
      isTrustedAppOrigin({
        origin: null,
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
  });

  it("trusts same-origin hosts only when local, configured, or wildcard-bound", () => {
    expect(
      isTrustedAppOrigin({
        origin: "http://evil.test:3773",
        requestOrigin: "http://evil.test:3773",
        config,
      }),
    ).toBe(false);
    expect(
      isTrustedAppOrigin({
        origin: "http://192.168.1.50:3773",
        requestOrigin: "http://192.168.1.50:3773",
        config: { ...config, host: "192.168.1.50" },
      }),
    ).toBe(true);
    expect(
      isTrustedAppOrigin({
        origin: "http://192.168.1.50:3773",
        requestOrigin: "http://192.168.1.50:3773",
        config: { ...config, host: "0.0.0.0" },
      }),
    ).toBe(true);
  });

  it("trusts only the HTTPS public origin for browser traffic in proxy-backed remote mode", () => {
    const remoteConfig = {
      ...config,
      host: "0.0.0.0",
      publicUrl: new URL("https://glade.example.test/"),
    };
    expect(
      isTrustedAppOrigin({
        origin: "https://glade.example.test",
        requestOrigin: "http://glade.example.test",
        config: remoteConfig,
      }),
    ).toBe(true);
    expect(
      isTrustedAppOrigin({
        origin: "http://192.168.1.50:3773",
        requestOrigin: "http://192.168.1.50:3773",
        config: remoteConfig,
      }),
    ).toBe(false);
  });

  it("normalizes desktop origins with trailing slashes", () => {
    expect(normalizeCorsOrigin("glade://app/")).toBe("glade://app");
    expect(normalizeCorsOrigin("glade-dev://app/")).toBeNull();
    expect(normalizeCorsOrigin("glade-cua://app/")).toBeNull();
    expect(normalizeCorsOrigin("glade-beta://app/")).toBeNull();
  });

  it("trusts the desktop origin at the request gate and rejects lookalikes", () => {
    for (const rawOrigin of ["glade://app"]) {
      expect(
        shouldRejectUntrustedRequestOrigin({
          rawOrigin,
          requestOrigin: "http://127.0.0.1:58090",
          config,
        }),
      ).toBe(false);
    }
    for (const rawOrigin of [
      "glade://evil.test",
      "glade-beta://evil.test",
      "glade-beta://app.evil.test",
      "glade-betas://app",
      "glade-dev://evil.test",
      "glade-cua://evil.test",
    ]) {
      expect(
        shouldRejectUntrustedRequestOrigin({
          rawOrigin,
          requestOrigin: "http://127.0.0.1:58090",
          config,
        }),
      ).toBe(true);
    }
  });

  it("rejects present but untrusted request origins for websocket-style gates", () => {
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: undefined,
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: "null",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: "https://example.test",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(true);
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: "http://localhost:5173",
        requestOrigin: "http://127.0.0.1:58090",
        config,
      }),
    ).toBe(false);
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: "http://192.168.1.50:3773",
        requestOrigin: "http://192.168.1.50:3773",
        config: { ...config, host: "0.0.0.0" },
      }),
    ).toBe(false);
  });

  it("requires websocket authentication for every non-loopback exposure", () => {
    expect(
      requiresWebSocketAuthentication({
        host: "127.0.0.1",
        authToken: undefined,
        publicUrl: undefined,
      }),
    ).toBe(false);
    expect(
      requiresWebSocketAuthentication({ host: "::1", authToken: undefined, publicUrl: undefined }),
    ).toBe(false);
    expect(
      requiresWebSocketAuthentication({
        host: "0.0.0.0",
        authToken: undefined,
        publicUrl: undefined,
      }),
    ).toBe(true);
    expect(
      requiresWebSocketAuthentication({ host: "::", authToken: undefined, publicUrl: undefined }),
    ).toBe(true);
    expect(
      requiresWebSocketAuthentication({
        host: "192.168.1.50",
        authToken: undefined,
        publicUrl: undefined,
      }),
    ).toBe(true);
    expect(
      requiresWebSocketAuthentication({
        host: "127.0.0.1",
        authToken: "secret",
        publicUrl: undefined,
      }),
    ).toBe(true);
    expect(
      requiresWebSocketAuthentication({
        host: "127.0.0.1",
        authToken: undefined,
        publicUrl: new URL("https://glade.example.test/"),
      }),
    ).toBe(true);
  });

  it("requires browser mutations to have a trusted origin or explicit bearer provenance", () => {
    expect(
      shouldRejectAuthMutationOrigin({
        rawOrigin: undefined,
        requestOrigin: "http://127.0.0.1:58090",
        config,
        credentialSource: "cookie",
      }),
    ).toBe(true);
    expect(
      shouldRejectAuthMutationOrigin({
        rawOrigin: undefined,
        requestOrigin: "http://127.0.0.1:58090",
        config,
        credentialSource: "bearer",
      }),
    ).toBe(false);
    expect(
      shouldRejectAuthMutationOrigin({
        rawOrigin: "http://localhost:5173",
        requestOrigin: "http://127.0.0.1:58090",
        config,
        credentialSource: "cookie",
      }),
    ).toBe(false);
    for (const rawOrigin of ["null", "not a url", "https://example.test"]) {
      expect(
        shouldRejectAuthMutationOrigin({
          rawOrigin,
          requestOrigin: "http://127.0.0.1:58090",
          config,
          credentialSource: "bearer",
        }),
      ).toBe(true);
    }
  });
});
