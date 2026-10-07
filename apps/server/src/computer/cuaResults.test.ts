import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import * as FS from "node:fs";

import { CuaListWindows, CuaToolResult, CuaWindowState } from "./cuaResults.ts";

// Captured from the pinned cua-driver 0.34.0 through its embedded MCP proxy (titles neutralised,
// trees trimmed). A Cua upgrade that renames or retypes a field Glade reads fails here.
const captured = (name: string) =>
  Schema.decodeUnknownSync(CuaToolResult)(
    JSON.parse(
      FS.readFileSync(new URL(`./fixtures/cua-0.34.0-${name}.json`, import.meta.url), "utf8"),
    ),
  );

describe("pinned Cua 0.34.0 results", () => {
  it("decodes list_windows", () => {
    const { windows } = Schema.decodeUnknownSync(CuaListWindows)(
      captured("list_windows").structuredContent,
    );
    assert.deepStrictEqual(
      windows.map((window) => [window.app_name, window.title, typeof window.window_id]),
      [
        ["Glade (Dev)", "Glade (Dev)", "number"],
        ["Notes", "Shopping list", "number"],
        ["Calculator", "", "number"],
      ],
    );
    assert.isTrue(windows.every((window) => typeof window.pid === "number"));
  });

  it("decodes get_window_state elements with their action tokens", () => {
    const state = Schema.decodeUnknownSync(CuaWindowState)(
      captured("get_window_state").structuredContent,
    );
    assert.strictEqual(state.window_title, "Glade (Dev)");
    assert.deepStrictEqual(
      state.elements?.map((element) => [element.element_index, element.role, element.depth]),
      [
        [0, "AXWindow", 0],
        [1, "AXWebArea", 1],
        [2, "AXButton", 2],
        [3, "AXButton", 3],
        [4, "AXStaticText", 3],
        [5, "AXStaticText", 3],
      ],
    );
    assert.isTrue(state.elements?.every((element) => element.element_token.length > 0));
  });
});
