import { describe, expect, it } from "vitest";

import { sanitizeStringKeyedRecord } from "./persistedRecord";

describe("sanitizeStringKeyedRecord", () => {
  it("returns an empty record for non-object input", () => {
    expect(sanitizeStringKeyedRecord(null, () => 1)).toEqual({});
    expect(sanitizeStringKeyedRecord([1, 2], () => 1)).toEqual({});
  });

  it("keeps entries the sanitizer accepts and drops the ones it rejects", () => {
    const result = sanitizeStringKeyedRecord<number>({ a: "1", b: "x", c: "3" }, (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && raw !== "x" ? parsed : null;
    });

    expect(result).toEqual({ a: 1, c: 3 });
  });

  it("ignores prototype-polluting keys from untrusted input", () => {
    const malicious = JSON.parse('{"safe": 1, "__proto__": {"polluted": true}, "constructor": 2}');

    const result = sanitizeStringKeyedRecord<unknown>(malicious, (raw) => raw);

    expect(result).toEqual({ safe: 1 });
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(Object.hasOwn(result, "constructor")).toBe(false);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
