import { Effect, Schema } from "effect";

import { resultText } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import {
  appWindows,
  callCua,
  computerTool,
  windowLine,
  type ComputerToolServices,
} from "./computerCalls.ts";
import { screenLine } from "./screenGeometry.ts";
import { targetFor, WindowTarget } from "./windowTarget.ts";

const Size = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1));

const bounds = (frame: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}) => `x ${frame.x}, y ${frame.y}, ${frame.width}×${frame.height}`;

// Cua's set_window_frame moves and resizes one window in the desktop coordinates list_windows
// reports (points, origin at the top left of the main display), then the window is listed again so
// the result states the geometry the app actually accepted (apps clamp to minimum sizes and the
// screen).
export const makeWindowFrameTool = (services: ComputerToolServices): ToolEntry =>
  computerTool(services, {
    name: "computer_window_frame",
    title: "Move or resize a window",
    description:
      "Move and resize a window to x, y, width, height in desktop points (origin at the main display's top left, as window bounds are listed; computer_apps lists each display's size and work area in the same points). Returns the geometry the window ended up with and the displays. Needs act access.",
    input: Schema.Struct({
      ...WindowTarget,
      x: Schema.Finite,
      y: Schema.Finite,
      width: Size,
      height: Size,
    }),
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const { target, window } = yield* targetFor(services, context, input, {
          scope: "act",
          action: "click",
        });
        const result = yield* callCua(services, context, "set_window_frame", {
          ...target,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
        });
        const [windows, screen] = yield* Effect.all(
          [appWindows(services, context, target.pid), screenLine(services)],
          { concurrency: "unbounded" },
        );
        const after = windows.find((entry) => entry.window_id === target.window_id);
        const lines = [
          after
            ? `Window frame is now ${bounds(after.bounds)} (asked ${bounds(input)}).`
            : resultText(result) || "Frame set; the window is no longer listed.",
          windowLine(after ?? window),
          screen,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  });
