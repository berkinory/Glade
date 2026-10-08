import { describe, expect, it } from "vitest";

import { selectOrphanedComposerImageBlobKeys } from "./composerImageBlobStore";

const hourMs = 60 * 60 * 1000;
const nowMs = 10 * hourMs;

describe("selectOrphanedComposerImageBlobKeys", () => {
  it.each([
    {
      name: "keeps referenced blobs regardless of age",
      records: [
        { key: "a", updatedAt: 0 },
        { key: "b", updatedAt: 0 },
      ],
      isReferenced: (key: string) => key === "a",
      minAgeMs: undefined,
      expected: ["b"],
    },
    {
      name: "keeps unreferenced blobs written within the default minimum age",
      records: [
        { key: "a", updatedAt: nowMs - hourMs / 2 },
        { key: "b", updatedAt: nowMs - 2 * hourMs },
      ],
      isReferenced: () => false,
      minAgeMs: undefined,
      expected: ["b"],
    },
    {
      name: "honors an explicit minimum age",
      records: [{ key: "a", updatedAt: nowMs - hourMs / 2 }],
      isReferenced: () => false,
      minAgeMs: hourMs / 4,
      expected: ["a"],
    },
    {
      name: "treats records without a write time as old",
      records: [{ key: "a" }],
      isReferenced: () => false,
      minAgeMs: undefined,
      expected: ["a"],
    },
  ])("$name", ({ records, isReferenced, minAgeMs, expected }) => {
    expect(
      selectOrphanedComposerImageBlobKeys(records, {
        isReferenced,
        nowMs,
        ...(minAgeMs === undefined ? {} : { minAgeMs }),
      }),
    ).toEqual(expected);
  });
});
