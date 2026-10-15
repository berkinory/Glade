import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { PublishedVisualReply, VisualComponentsInput } from "./visualComponents";

const decodeInput = Schema.decodeUnknownExit(VisualComponentsInput);
const decodeReply = Schema.decodeUnknownSync(PublishedVisualReply);

const chart = {
  type: "chart",
  kind: "line",
  labels: ["Mon", "Tue"],
  series: [{ name: "Builds", values: [3, 5] }],
};
const table = { type: "table", columns: ["Name", "Score"], rows: [["a", 1]] };
const spec = (blocks: readonly unknown[]) => ({ title: "Report", blocks });

describe("VisualComponentsInput", () => {
  it("accepts every block type, with leaf blocks grouped in tabs", () => {
    const input = spec([
      {
        type: "stats",
        items: [
          { label: "Pass rate", value: "98%", trend: "up" },
          { label: "Builds", value: 42 },
        ],
      },
      {
        type: "tabs",
        tabs: [
          { label: "Trend", blocks: [chart] },
          { label: "Detail", blocks: [table, { type: "checklist", items: [{ label: "Ship" }] }] },
        ],
      },
      { type: "choices", options: [{ label: "Fix it", message: "Fix the failing test" }] },
    ]);
    expect(decodeInput(input)._tag).toBe("Success");
  });

  it.each([
    ["an unknown block type", spec([{ type: "html", html: "<script></script>" }])],
    [
      "tabs nested in tabs",
      spec([
        {
          type: "tabs",
          tabs: [
            { label: "A", blocks: [{ type: "tabs", tabs: [] }] },
            { label: "B", blocks: [chart] },
          ],
        },
      ]),
    ],
    ["a row with a missing cell", spec([{ ...table, rows: [["a"]] }])],
    [
      "a series with a missing value",
      spec([{ ...chart, series: [{ name: "Builds", values: [3] }] }]),
    ],
    [
      "a line chart with one point",
      spec([{ ...chart, labels: ["Mon"], series: [{ name: "B", values: [1] }] }]),
    ],
    ["a non-finite value", spec([{ ...chart, series: [{ name: "B", values: [1, Number.NaN] }] }])],
    [
      "more than 100 table rows",
      spec([{ ...table, rows: Array.from({ length: 101 }, () => ["a", 1]) }]),
    ],
    [
      "more than 6 choices",
      spec([{ type: "choices", options: Array.from({ length: 7 }, () => ({ label: "x" })) }]),
    ],
    ["an overlong label", spec([{ type: "checklist", items: [{ label: "x".repeat(201) }] }])],
    ["more than 12 blocks", spec(Array.from({ length: 13 }, () => chart))],
    [
      "a spec over the byte limit",
      spec(
        Array.from({ length: 2 }, () => ({
          type: "table",
          columns: Array.from({ length: 8 }, (_, index) => `c${index}`),
          rows: Array.from({ length: 100 }, () => Array.from({ length: 8 }, () => "x".repeat(200))),
        })),
      ),
    ],
  ])("rejects %s", (_name, input) => {
    expect(decodeInput(input)._tag).toBe("Failure");
  });
});

describe("PublishedVisualReply", () => {
  it("keeps stored HTML payloads, which have no format field, decoding as HTML", () => {
    const reply = decodeReply({
      version: 1,
      threadId: "thread",
      title: "Chart",
      attachmentId: `att_v2_${"a".repeat(32)}`,
    });
    expect("format" in reply).toBe(false);
    expect(
      decodeReply({
        version: 1,
        format: "components",
        threadId: "thread",
        title: "Chart",
        blocks: [chart],
      }),
    ).toMatchObject({ format: "components" });
  });
});
