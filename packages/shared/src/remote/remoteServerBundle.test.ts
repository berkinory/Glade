import { describe, expect, it } from "vitest";

import { compareRemoteServerVersions } from "./remoteServerBundle";

// A wrong order downgrades a host's server, which then cannot open its migrated database.
describe("compareRemoteServerVersions", () => {
  it.each([
    ["0.2.10", "0.2.9", 1],
    ["0.3.0", "0.2.99", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0", "1.0.0-beta.2", 1],
    ["1.0.0-beta.10", "1.0.0-beta.2", 1],
    ["1.0.0+build.5", "1.0.0", 0],
    ["0.2.1", "0.2.2", -1],
  ])("orders %s against %s", (left, right, expected) => {
    expect(compareRemoteServerVersions(left, right)).toBe(expected);
  });
});
