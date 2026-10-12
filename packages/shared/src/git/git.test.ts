import { describe, expect, it } from "vitest";

import { resolveAutoFeatureBranchName } from "./git";

describe("resolveAutoFeatureBranchName", () => {
  it.each([
    { existing: ["feature/cache"], preferred: "cache", expected: "feature/cache-2" },
    { existing: ["feature/cache"], preferred: "cache/retry", expected: "feature/cache-2/retry" },
    { existing: ["feature/cache/retry"], preferred: "cache", expected: "feature/cache-2" },
    {
      existing: ["feature/cache", "feature/cache-2/retry/child"],
      preferred: "cache/retry",
      expected: "feature/cache-3/retry",
    },
    {
      existing: ["feature", "feature-2"],
      preferred: "cache/retry",
      expected: "feature-3/cache/retry",
    },
    {
      existing: ["feature/cached", "feature/cacheable/child"],
      preferred: "cache",
      expected: "feature/cache",
    },
  ])("picks $expected next to $existing", ({ existing, preferred, expected }) => {
    expect(resolveAutoFeatureBranchName(existing, preferred)).toBe(expected);
  });
});
