import { describe, expect, it } from "vitest";
import { readActivityPassage } from "./activityPassage";
import { redactDiagnosticValue } from "./diagnosticSanitizer";

describe("original activity evidence", () => {
  it("retains late failure evidence while redacting credentials before page boundaries", () => {
    const secret = "sensitive-value-that-crosses-the-page-boundary";
    const output = `${"log line\n".repeat(600)}Authorization: Bearer ${secret}\nFINAL RESULT: failed`;
    const payload = { output, apiKey: secret };
    const prepared = redactDiagnosticValue(payload);
    expect(prepared).toEqual({
      output: `${"log line\n".repeat(600)}Authorization: [redacted]\nFINAL RESULT: failed`,
      apiKey: "[redacted]",
    });
    let offset = 0;
    let collected = "";
    for (;;) {
      const page = readActivityPassage({ payload, path: ["output"], offset, maxChars: 50 });
      if (!("text" in page)) throw new Error("Expected a string passage");
      collected += page.text;
      if (!("nextOffsetChars" in page) || page.nextOffsetChars === undefined) break;
      offset = page.nextOffsetChars;
    }
    expect(collected).toContain("FINAL RESULT: failed");
    expect(collected).toContain("Authorization: [redacted]");
    expect(collected).not.toContain(secret);
    expect(readActivityPassage({ payload, path: ["apiKey"], offset: 0, maxChars: 50 })).toEqual({
      path: ["apiKey"],
      value: "[redacted]",
    });
  });
});
