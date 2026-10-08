import { describe, expect, it } from "vitest";

import type { ServerConfigShape } from "../config";
import {
  isTrustedAppOrigin,
  normalizeCorsOrigin,
  requiresWebSocketAuthentication,
  shouldRejectUntrustedRequestOrigin,
} from "./trustedOrigins";

const config = {
  devUrl: new URL("http://localhost:5173/"),
} as ServerConfigShape;
const LOCAL_REQUEST = "http://127.0.0.1:58090";
const LAN_ORIGIN = "http://192.168.1.50:3773";
const PUBLIC_URL = new URL("https://glade.example.test/");
const remoteConfig = { ...config, host: "0.0.0.0", publicUrl: PUBLIC_URL };

describe("trustedOrigins", () => {
  it.each([
    { origin: LOCAL_REQUEST, requestOrigin: LOCAL_REQUEST, cfg: config, trusted: true },
    { origin: "http://localhost:5173", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: true },
    { origin: "glade://app", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: true },
    { origin: "glade-dev://app", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: false },
    { origin: "glade-cua://app", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: false },
    { origin: "glade-beta://app", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: false },
    { origin: "https://example.test", requestOrigin: LOCAL_REQUEST, cfg: config, trusted: false },
    { origin: null, requestOrigin: LOCAL_REQUEST, cfg: config, trusted: true },
    {
      origin: "http://evil.test:3773",
      requestOrigin: "http://evil.test:3773",
      cfg: config,
      trusted: false,
    },
    {
      origin: LAN_ORIGIN,
      requestOrigin: LAN_ORIGIN,
      cfg: { ...config, host: "192.168.1.50" },
      trusted: true,
    },
    {
      origin: LAN_ORIGIN,
      requestOrigin: LAN_ORIGIN,
      cfg: { ...config, host: "0.0.0.0" },
      trusted: true,
    },
    {
      origin: "https://glade.example.test",
      requestOrigin: "http://glade.example.test",
      cfg: remoteConfig,
      trusted: true,
    },
    { origin: LAN_ORIGIN, requestOrigin: LAN_ORIGIN, cfg: remoteConfig, trusted: false },
  ])("isTrustedAppOrigin($origin from $requestOrigin) is $trusted", (row) => {
    expect(
      isTrustedAppOrigin({ origin: row.origin, requestOrigin: row.requestOrigin, config: row.cfg }),
    ).toBe(row.trusted);
  });

  it.each([
    ["glade://app/", "glade://app"],
    ["glade-dev://app/", null],
    ["glade-cua://app/", null],
    ["glade-beta://app/", null],
  ])("normalizeCorsOrigin(%s) is %s", (origin, expected) => {
    expect(normalizeCorsOrigin(origin)).toBe(expected);
  });

  it.each([
    { rawOrigin: "glade://app", requestOrigin: LOCAL_REQUEST, cfg: config, reject: false },
    { rawOrigin: "glade://evil.test", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    {
      rawOrigin: "glade-beta://evil.test",
      requestOrigin: LOCAL_REQUEST,
      cfg: config,
      reject: true,
    },
    {
      rawOrigin: "glade-beta://app.evil.test",
      requestOrigin: LOCAL_REQUEST,
      cfg: config,
      reject: true,
    },
    { rawOrigin: "glade-betas://app", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    { rawOrigin: "glade-dev://evil.test", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    { rawOrigin: "glade-cua://evil.test", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    { rawOrigin: undefined, requestOrigin: LOCAL_REQUEST, cfg: config, reject: false },
    { rawOrigin: "null", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    { rawOrigin: "https://example.test", requestOrigin: LOCAL_REQUEST, cfg: config, reject: true },
    {
      rawOrigin: "http://localhost:5173",
      requestOrigin: LOCAL_REQUEST,
      cfg: config,
      reject: false,
    },
    {
      rawOrigin: LAN_ORIGIN,
      requestOrigin: LAN_ORIGIN,
      cfg: { ...config, host: "0.0.0.0" },
      reject: false,
    },
  ])("shouldRejectUntrustedRequestOrigin($rawOrigin) is $reject", (row) => {
    expect(
      shouldRejectUntrustedRequestOrigin({
        rawOrigin: row.rawOrigin,
        requestOrigin: row.requestOrigin,
        config: row.cfg,
      }),
    ).toBe(row.reject);
  });

  it.each([
    { host: "127.0.0.1", authToken: undefined, publicUrl: undefined, required: false },
    { host: "::1", authToken: undefined, publicUrl: undefined, required: false },
    { host: "0.0.0.0", authToken: undefined, publicUrl: undefined, required: true },
    { host: "::", authToken: undefined, publicUrl: undefined, required: true },
    { host: "192.168.1.50", authToken: undefined, publicUrl: undefined, required: true },
    { host: "127.0.0.1", authToken: "secret", publicUrl: undefined, required: true },
    { host: "127.0.0.1", authToken: undefined, publicUrl: PUBLIC_URL, required: true },
  ])(
    "requiresWebSocketAuthentication($host, token=$authToken, publicUrl=$publicUrl) is $required",
    ({ required, ...exposure }) => {
      expect(requiresWebSocketAuthentication(exposure)).toBe(required);
    },
  );
});
