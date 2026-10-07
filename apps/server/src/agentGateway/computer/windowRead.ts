import { Effect, Option } from "effect";

import type { ToolContext } from "../toolRuntime.ts";
import {
  callCua,
  recordSnapshot,
  SCREENSHOT_MAX_EDGE,
  type ComputerToolServices,
  type ReadScope,
  type WindowInput,
} from "./computerCalls.ts";

// Open and Save panels list every visible folder in their column browser, and a full walk spends
// Cua's whole time budget there before it reaches the panel's own fields and buttons. Those sit
// within this depth (measured on TextEdit and Preview panels), so a cut read that shows a sheet
// is repeated at it.
export const SHEET_READ_DEPTH = 5;

export interface WindowRead {
  readonly query?: string;
  readonly maxDepth?: number;
  // "context" grabs a screenshot that is not returned: a tree-only read would replace the one Cua
  // maps pixel coordinates through, and the next pixel action would be refused.
  readonly screenshot: "none" | "context" | "return";
}

// One recorded read of a window's tree, narrowed to the sheet depth when a sheet's controls
// would otherwise be cut off.
export const readWindow = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  read: WindowRead,
) =>
  Effect.gen(function* () {
    const args = {
      pid: input.pid,
      window_id: input.window_id,
      include_screenshot: read.screenshot !== "none",
      max_image_dimension: SCREENSHOT_MAX_EDGE,
      ...(read.query ? { query: read.query } : {}),
      ...(read.maxDepth ? { max_depth: read.maxDepth } : {}),
    };
    let result = yield* callCua(services, context, "get_window_state", args);
    let scope: ReadScope = read.query ? "query" : read.maxDepth ? "depth" : "full";
    const cutWithSheet =
      read.maxDepth === undefined &&
      result.structuredContent?.truncated === true &&
      Array.isArray(result.structuredContent.elements) &&
      result.structuredContent.elements.some(
        (element: unknown) => (element as { role?: unknown }).role === "AXSheet",
      );
    if (cutWithSheet) {
      result = yield* callCua(services, context, "get_window_state", {
        ...args,
        max_depth: SHEET_READ_DEPTH,
      });
      scope = read.query ? "query" : "depth";
    }
    const snapshot = recordSnapshot(services, context, input, result, scope);
    const notes = Option.match(snapshot.state, {
      onNone: () => [],
      onSome: (value) => [
        ...(cutWithSheet
          ? [
              `A sheet is open, so this read stops at depth ${SHEET_READ_DEPTH} to reach its controls.`,
            ]
          : value.truncated
            ? ["The tree was truncated; narrow with query or max_depth."]
            : []),
        ...(value.degraded_reason ? [`Degraded: ${value.degraded_reason}.`] : []),
      ],
    });
    return { result, notes, ...snapshot };
  });
