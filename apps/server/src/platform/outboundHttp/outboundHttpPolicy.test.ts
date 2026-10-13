import { describe, expect, it } from "vitest";

import {
  encodeOutboundMultipart,
  invokePinnedDnsLookup,
  OutboundHttpError,
} from "./outboundHttp.ts";
import {
  assertExactLoopbackIpAddress,
  assertJsonWithinLimits,
  assertOutboundUrlAllowed,
  isPublicIpAddress,
  normalizeOutboundOrigin,
  OutboundPolicyError,
} from "./outboundHttpPolicy.ts";

describe("outbound HTTP URL policy", () => {
  it("keeps HTTPS as the default", () => {
    expect(normalizeOutboundOrigin("https://api.example.com/path")).toBe("https://api.example.com");
    expect(() => normalizeOutboundOrigin("http://localhost:3000")).toThrowError(
      OutboundPolicyError,
    );
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "allows opted-in exact loopback origin %s",
    (url) => {
      expect(normalizeOutboundOrigin(url, { allowLoopbackHttp: true })).toBe(new URL(url).origin);
      expect(
        assertOutboundUrlAllowed({
          url: `${url}/status`,
          allowedOrigins: [new URL(url).origin],
          allowLoopbackHttp: true,
        }).pathname,
      ).toBe("/status");
    },
  );

  it.each([
    "http://api.example.com",
    "http://localhost.example.com",
    "http://dev.localhost:3000",
    "http://127.0.0.2:3000",
    "http://192.168.1.5:3000",
  ])("rejects opted-in non-loopback HTTP origin %s", (url) => {
    expect(() => normalizeOutboundOrigin(url, { allowLoopbackHttp: true })).toThrowError(
      OutboundPolicyError,
    );
  });

  it("rejects URL credentials with the loopback opt-in", () => {
    expect(() =>
      assertOutboundUrlAllowed({
        url: "http://user:password@localhost:3000/status",
        allowedOrigins: ["http://localhost:3000"],
        allowLoopbackHttp: true,
      }),
    ).toThrowError(OutboundPolicyError);
  });

  it("accepts only exact loopback addresses for opted-in transport pinning", () => {
    expect(() => assertExactLoopbackIpAddress("127.0.0.1")).not.toThrow();
    expect(() => assertExactLoopbackIpAddress("::1")).not.toThrow();
    expect(() => assertExactLoopbackIpAddress("127.0.0.2")).toThrowError(OutboundPolicyError);
    expect(() => assertExactLoopbackIpAddress("192.168.1.5")).toThrowError(OutboundPolicyError);
  });
});

describe("isPublicIpAddress", () => {
  it("rejects every textual form of an IPv4-mapped IPv6 address", () => {
    expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPublicIpAddress("0:0:0:0:0:ffff:8.8.8.8")).toBe(false);
    expect(isPublicIpAddress("::ffff:0808:0808")).toBe(false);
    expect(isPublicIpAddress("0:0:0:0:0:ffff:0808:0808")).toBe(false);
  });

  it("still accepts ordinary public IPv4 and IPv6 addresses", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });
});

describe("outbound HTTP policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.5",
    "::1",
    "fc00::1",
    "fe80::1",
    "64:ff9b::127.0.0.1",
    "2001:db8::1",
  ])("rejects private or reserved address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it("pins requests to an exact HTTPS origin", () => {
    expect(
      assertOutboundUrlAllowed({
        url: "https://api.x.ai/v1/language-models",
        allowedOrigins: ["https://api.x.ai"],
      }).pathname,
    ).toBe("/v1/language-models");
    expect(() =>
      assertOutboundUrlAllowed({
        url: "https://attacker.example/language-models",
        allowedOrigins: ["https://api.x.ai"],
      }),
    ).toThrowError(OutboundPolicyError);
    expect(() =>
      assertOutboundUrlAllowed({
        url: "http://api.x.ai/language-models",
        allowedOrigins: ["https://api.x.ai"],
      }),
    ).toThrowError(OutboundPolicyError);
  });

  it("bounds parsed JSON depth and node count", () => {
    expect(() =>
      assertJsonWithinLimits({ a: { b: { c: true } } }, { maxDepth: 2, maxNodes: 20 }),
    ).toThrowError(/depth limit/u);
    expect(() => assertJsonWithinLimits([1, 2, 3], { maxDepth: 2, maxNodes: 3 })).toThrowError(
      /node limit/u,
    );
  });

  it("encodes multipart bodies under an explicit byte budget", () => {
    const multipart = encodeOutboundMultipart(
      [
        {
          name: "file",
          filename: "voice.wav",
          contentType: "audio/wav",
          body: new Uint8Array([1, 2, 3]),
        },
      ],
      { maxBytes: 1_024 },
    );
    const body = new TextDecoder().decode(multipart.body);
    expect(multipart.contentType).toMatch(/^multipart\/form-data; boundary=Glade-/u);
    expect(body).toContain('name="file"; filename="voice.wav"');
    expect(() =>
      encodeOutboundMultipart([{ name: "file", body: "oversize" }], { maxBytes: 4 }),
    ).toThrowError(OutboundHttpError);
    expect(() =>
      encodeOutboundMultipart(
        [{ name: "file", contentType: "audio/wav\r\nx-credential: leak", body: "x" }],
        { maxBytes: 1_024 },
      ),
    ).toThrowError(/content type is invalid/u);
  });
});

describe("invokePinnedDnsLookup", () => {
  const pinned = [
    { address: "2001:db8::1", family: 6 },
    { address: "1.2.3.4", family: 4 },
  ] as const;

  it("returns the legacy single-address form when all is not requested", async () => {
    let result: unknown;
    invokePinnedDnsLookup(pinned, {}, (err, address, family) => {
      result = { err, address, family };
    });
    expect(result).toBeUndefined();
    await Promise.resolve();
    expect(result).toEqual({ err: null, address: "2001:db8::1", family: 6 });
  });

  it("returns the array form when Happy Eyeballs requests all addresses", async () => {
    let result: unknown;
    invokePinnedDnsLookup(pinned, { all: true }, (err, address, family) => {
      result = { err, address, family };
    });
    expect(result).toBeUndefined();
    await Promise.resolve();
    expect(result).toEqual({
      err: null,
      address: [
        { address: "2001:db8::1", family: 6 },
        { address: "1.2.3.4", family: 4 },
      ],
      family: undefined,
    });
  });
});
