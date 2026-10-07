import { Effect, Schema } from "effect";

import type { ToolEntry } from "../toolRuntime.ts";
import {
  actionContent,
  callCua,
  computerTool,
  imageContent,
  keyCall,
  SCREENSHOT_MAX_EDGE,
  windowFor,
  type ComputerToolServices,
} from "./computerCalls.ts";

// Pixel tools address one window in the pixel space of its latest computer_screenshot (or a
// computer_window_state screenshot). Cua maps those pixels back to the screen itself, so the
// server passes coordinates through unchanged.
const WindowRef = {
  pid: Schema.Int.annotate({ description: "Process id from computer_apps." }),
  window_id: Schema.Int.annotate({ description: "Window id from computer_apps." }),
};
const Coordinate = Schema.Number.annotate({
  description: "Pixels in the latest screenshot of this window.",
});
const Point = { ...WindowRef, x: Coordinate, y: Coordinate };
const Modifiers = Schema.optional(
  Schema.Array(Schema.Literals(["cmd", "shift", "option", "ctrl"])).annotate({
    description: "Modifier keys held during the click.",
  }),
);
const Delivery = Schema.optional(
  Schema.Literals(["background", "foreground"]).annotate({
    description:
      "background (default) posts input without focusing the window; foreground fronts it briefly and needs full control.",
  }),
);

const ClickInput = Schema.Struct({ ...Point, modifiers: Modifiers, delivery: Delivery });
const MAX_WAIT_SECONDS = 10;

export function makePixelComputerTools(services: ComputerToolServices): ToolEntry[] {
  const scopeFor = (delivery: "background" | "foreground" | undefined) =>
    delivery === "foreground" ? "full" : "act";

  const click = (
    name: string,
    title: string,
    description: string,
    tool: string,
    extra: Record<string, unknown> = {},
  ) =>
    computerTool(services, {
      name,
      title,
      description: `${description} Needs act access; foreground needs full control.`,
      input: ClickInput,
      readOnly: false,
      run: (input, context) =>
        windowFor(services, context, input, scopeFor(input.delivery)).pipe(
          Effect.andThen(
            callCua(services, context, tool, {
              pid: input.pid,
              window_id: input.window_id,
              x: input.x,
              y: input.y,
              delivery_mode: input.delivery ?? "background",
              ...(input.modifiers && input.modifiers.length > 0
                ? { modifier: input.modifiers }
                : {}),
              ...extra,
            }),
          ),
          Effect.map(actionContent),
        ),
    });

  return [
    computerTool(services, {
      name: "computer_screenshot",
      title: "Screenshot a window",
      description: `JPEG of one window, at most ${SCREENSHOT_MAX_EDGE} px on the long edge; pixel tools take coordinates in this image. Use it when the accessibility tree lacks the target or an action's effect is unverifiable. Needs read access.`,
      input: Schema.Struct(WindowRef),
      readOnly: true,
      run: (input, context) =>
        Effect.gen(function* () {
          yield* windowFor(services, context, input, "read");
          const result = yield* callCua(services, context, "get_window_state", {
            pid: input.pid,
            window_id: input.window_id,
            include_accessibility_tree: false,
            max_image_dimension: SCREENSHOT_MAX_EDGE,
          });
          return { content: yield* imageContent(services, context, result) };
        }),
    }),
    computerTool(services, {
      name: "computer_zoom",
      title: "Zoom into a window",
      description:
        "JPEG close-up of a region (x1,y1)-(x2,y2) of the latest screenshot, for reading small text before asking for anything larger. Coordinates for actions stay in the screenshot's space. Needs read access.",
      input: Schema.Struct({
        ...WindowRef,
        x1: Coordinate,
        y1: Coordinate,
        x2: Coordinate,
        y2: Coordinate,
      }),
      readOnly: true,
      run: (input, context) =>
        Effect.gen(function* () {
          yield* windowFor(services, context, input, "read");
          const result = yield* callCua(services, context, "zoom", input);
          return { content: yield* imageContent(services, context, result) };
        }),
    }),
    click("computer_left_click", "Click at a point", "Left-click at (x, y).", "click"),
    click(
      "computer_right_click",
      "Right-click at a point",
      "Right-click at (x, y).",
      "right_click",
    ),
    click(
      "computer_double_click",
      "Double-click at a point",
      "Double-click at (x, y).",
      "double_click",
    ),
    click("computer_triple_click", "Triple-click at a point", "Triple-click at (x, y).", "click", {
      count: 3,
    }),
    computerTool(services, {
      name: "computer_left_click_drag",
      title: "Drag between points",
      description:
        "Press at (start_x, start_y), drag to (x, y) and release. The pointer must move for real, so this fronts the window and needs full control.",
      input: Schema.Struct({ ...Point, start_x: Coordinate, start_y: Coordinate }),
      readOnly: false,
      run: (input, context) =>
        windowFor(services, context, input, "full").pipe(
          Effect.andThen(
            callCua(services, context, "drag", {
              pid: input.pid,
              window_id: input.window_id,
              from_x: input.start_x,
              from_y: input.start_y,
              to_x: input.x,
              to_y: input.y,
              delivery_mode: "foreground",
            }),
          ),
          Effect.map(actionContent),
        ),
    }),
    computerTool(services, {
      name: "computer_scroll",
      title: "Scroll at a point",
      description:
        "Scroll the region under (x, y) by amount wheel notches. Needs act access; foreground needs full control.",
      input: Schema.Struct({
        ...Point,
        direction: Schema.Literals(["up", "down", "left", "right"]),
        amount: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
        delivery: Delivery,
      }),
      readOnly: false,
      run: (input, context) =>
        windowFor(services, context, input, scopeFor(input.delivery)).pipe(
          Effect.andThen(
            callCua(services, context, "scroll", {
              pid: input.pid,
              window_id: input.window_id,
              x: input.x,
              y: input.y,
              direction: input.direction,
              amount: input.amount ?? 3,
              delivery_mode: input.delivery ?? "background",
            }),
          ),
          Effect.map(actionContent),
        ),
    }),
    computerTool(services, {
      name: "computer_type",
      title: "Type text",
      description:
        "Type text into the window's focused field (click it first). Needs act access; foreground needs full control.",
      input: Schema.Struct({ ...WindowRef, text: Schema.String, delivery: Delivery }),
      readOnly: false,
      run: (input, context) =>
        windowFor(services, context, input, scopeFor(input.delivery)).pipe(
          Effect.andThen(
            callCua(services, context, "type_text", {
              pid: input.pid,
              window_id: input.window_id,
              text: input.text,
              delivery_mode: input.delivery ?? "background",
            }),
          ),
          Effect.map(actionContent),
        ),
    }),
    computerTool(services, {
      name: "computer_key",
      title: "Press a key",
      description:
        'Press a key ("return", "escape", "tab", "down") or a chord ("cmd+a", "cmd+shift+z") in the window. Needs act access; foreground needs full control.',
      input: Schema.Struct({ ...WindowRef, key: Schema.String, delivery: Delivery }),
      readOnly: false,
      run: (input, context) =>
        windowFor(services, context, input, scopeFor(input.delivery)).pipe(
          Effect.andThen(() => {
            const key = keyCall(input.key);
            return callCua(services, context, key.tool, {
              pid: input.pid,
              window_id: input.window_id,
              delivery_mode: input.delivery ?? "background",
              ...key.args,
            });
          }),
          Effect.map(actionContent),
        ),
    }),
    computerTool(services, {
      name: "computer_wait",
      title: "Wait",
      description: `Wait up to ${MAX_WAIT_SECONDS} seconds for the app to settle, then look again.`,
      input: Schema.Struct({
        seconds: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: MAX_WAIT_SECONDS })),
      }),
      readOnly: true,
      run: (input) =>
        Effect.sleep(input.seconds * 1000).pipe(
          Effect.as({ content: [{ type: "text" as const, text: `Waited ${input.seconds}s.` }] }),
        ),
    }),
  ];
}
