import { describe, expect, it } from "vitest";

import { keepHeadAndTail } from "./activityPayloads.ts";

const MARKER = "|cut|";

describe("keepHeadAndTail", () => {
  it("keeps the start and the end of long output", () => {
    const output = `RUN tests\n${"x".repeat(200)}\nTests  451 passed (451)`;
    const kept = keepHeadAndTail(output, 80, MARKER);
    expect(kept).toHaveLength(80);
    expect(kept.startsWith("RUN tests")).toBe(true);
    expect(kept.endsWith("Tests  451 passed (451)")).toBe(true);
  });

  it("keeps the same start when streamed output grows past the limit", () => {
    let buffered = "";
    for (let chunk = 0; chunk < 50; chunk += 1) {
      buffered = keepHeadAndTail(`${buffered}line ${chunk}\n`, 60, MARKER);
    }
    expect(buffered.startsWith("line 0\n")).toBe(true);
    expect(buffered.split(MARKER)).toHaveLength(2);
    expect(buffered.endsWith("line 49\n")).toBe(true);
  });

  it("leaves output within the limit unchanged", () => {
    expect(keepHeadAndTail("short", 60, MARKER)).toBe("short");
  });
});
