import { describe, expect, it } from "vitest";

import { normalizeHttpsPublicOrigin, remoteAccessPolicyError } from "./config";

const remoteBase = {
  host: "0.0.0.0",
  authToken: "remote-secret",
  devUrl: undefined,
  publicUrl: undefined,
  allowInsecureRemote: false,
} as const;

describe("remote access policy", () => {
  it("requires authentication when an HTTPS proxy publishes a loopback bind", () => {
    expect(
      remoteAccessPolicyError({
        ...remoteBase,
        host: "127.0.0.1",
        authToken: undefined,
        publicUrl: new URL("https://glade.example.test/"),
      }),
    ).toContain("without GLADE_AUTH_TOKEN");
  });

  it("accepts only credential-free HTTPS root origins", () => {
    expect(normalizeHttpsPublicOrigin(new URL("https://glade.example.test/"))?.origin).toBe(
      "https://glade.example.test",
    );
    for (const value of [
      "http://glade.example.test/",
      "https://user:pass@glade.example.test/",
      "https://glade.example.test/app",
      "https://glade.example.test/?query=1",
      "https://glade.example.test/#fragment",
    ]) {
      const publicUrl = new URL(value);
      expect(normalizeHttpsPublicOrigin(publicUrl)).toBeNull();
      expect(remoteAccessPolicyError({ ...remoteBase, host: "127.0.0.1", publicUrl })).toContain(
        "must be an HTTPS root origin",
      );
    }
  });
});
