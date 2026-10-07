import { Effect, Schema } from "effect";

import type { ToolEntry } from "../toolRuntime.ts";
import { keyCall, windowAction } from "./computerActions.ts";
import {
  callCua,
  computerTool,
  SCREENSHOT_MAX_EDGE,
  imageContent,
  windowFor,
  type ComputerToolServices,
} from "./computerCalls.ts";

// Pixel tools address one window in the pixel space of its latest computer_screenshot (or a
// computer_window_state screenshot). Cua maps those pixels back to the screen itself, so the
// server passes coordinates through unchanged. Names and parameters follow Anthropic's computer
// toolset (coordinate, start_coordinate, region, scroll_direction, text) with a window added.
const WindowRef = {
  pid: Schema.Int.annotate({ description: "Process id from computer_apps." }),
  window_id: Schema.Int.annotate({ description: "Window id from computer_apps." }),
};
const pair = (description: string) =>
  Schema.Array(Schema.Number)
    .check(Schema.isMinLength(2), Schema.isMaxLength(2))
    .annotate({ description });
const Coordinate = pair("[x, y] in pixels of the latest screenshot of this window.");
const Modifiers = Schema.optional(
  Schema.String.annotate({
    description:
      'Modifier keys held during the click, "+"-joined: shift, ctrl, alt (option), cmd (super). Modifier clicks are delivered in the foreground and need full control.',
  }),
);
const Delivery = Schema.optional(
  Schema.Literals(["background", "foreground"]).annotate({
    description:
      "background (default) posts input without focusing the window; foreground fronts it briefly and needs full control.",
  }),
);

const ClickInput = Schema.Struct({
  ...WindowRef,
  coordinate: Coordinate,
  text: Modifiers,
  delivery: Delivery,
});

const MODIFIER_NAMES: Record<string, string> = {
  shift: "shift",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "option",
  option: "option",
  cmd: "cmd",
  command: "cmd",
  super: "cmd",
  meta: "cmd",
};

const modifierList = (text: string | undefined) =>
  (text ?? "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .map((part) => MODIFIER_NAMES[part] ?? part);

const scopeFor = (delivery: "background" | "foreground" | undefined) =>
  delivery === "foreground" ? "full" : "act";

export function makePixelComputerTools(services: ComputerToolServices): ToolEntry[] {
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
        Effect.suspend(() => {
          const modifier = modifierList(input.text);
          // macOS only sees physical modifier state, so Cua requires foreground for these.
          const delivery = modifier.length > 0 ? "foreground" : (input.delivery ?? "background");
          return windowAction(
            services,
            context,
            input,
            {
              scope: scopeFor(delivery),
              action: tool === "right_click" || modifier.length > 0 ? "input" : "click",
            },
            {
              tool,
              args: {
                pid: input.pid,
                window_id: input.window_id,
                x: input.coordinate[0],
                y: input.coordinate[1],
                delivery_mode: delivery,
                ...(modifier.length > 0 ? { modifier } : {}),
                ...extra,
              },
            },
          );
        }),
    });

  return [
    computerTool(services, {
      name: "computer_screenshot",
      title: "Screenshot a window",
      description: `JPEG of one window only, at most ${SCREENSHOT_MAX_EDGE} px on the long edge; pixel tools take coordinates in this image. Use it when the accessibility tree lacks the target or an action's effect is unverifiable. Needs read access.`,
      input: Schema.Struct(WindowRef),
      readOnly: true,
      run: (input, context) =>
        Effect.gen(function* () {
          yield* windowFor(services, context, input, { scope: "read", action: "read" });
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
        "JPEG close-up of region [x0, y0, x1, y1] of the latest screenshot, for reading small text before asking for anything larger. Coordinates for actions stay in the screenshot's space. Needs read access.",
      input: Schema.Struct({
        ...WindowRef,
        region: Schema.Array(Schema.Number)
          .check(Schema.isMinLength(4), Schema.isMaxLength(4))
          .annotate({ description: "[x0, y0, x1, y1]: top-left and bottom-right corners." }),
      }),
      readOnly: true,
      run: (input, context) =>
        Effect.gen(function* () {
          yield* windowFor(services, context, input, { scope: "read", action: "read" });
          const [x1, y1, x2, y2] = input.region;
          const result = yield* callCua(services, context, "zoom", {
            pid: input.pid,
            window_id: input.window_id,
            x1,
            y1,
            x2,
            y2,
          });
          return { content: yield* imageContent(services, context, result) };
        }),
    }),
    click("computer_left_click", "Click at a point", "Left-click at coordinate.", "click"),
    click(
      "computer_right_click",
      "Right-click at a point",
      "Right-click at coordinate.",
      "right_click",
    ),
    click(
      "computer_double_click",
      "Double-click at a point",
      "Double-click at coordinate.",
      "double_click",
    ),
    click(
      "computer_triple_click",
      "Triple-click at a point",
      "Triple-click at coordinate.",
      "click",
      { count: 3 },
    ),
    computerTool(services, {
      name: "computer_left_click_drag",
      title: "Drag between points",
      description:
        "Press at start_coordinate, drag to coordinate and release. The pointer must move for real, so this fronts the window and needs full control.",
      input: Schema.Struct({
        ...WindowRef,
        start_coordinate: Coordinate,
        coordinate: Coordinate,
      }),
      readOnly: false,
      run: (input, context) =>
        windowAction(
          services,
          context,
          input,
          { scope: "full", action: "input" },
          {
            tool: "drag",
            args: {
              pid: input.pid,
              window_id: input.window_id,
              from_x: input.start_coordinate[0],
              from_y: input.start_coordinate[1],
              to_x: input.coordinate[0],
              to_y: input.coordinate[1],
              delivery_mode: "foreground",
            },
          },
        ),
    }),
    computerTool(services, {
      name: "computer_scroll",
      title: "Scroll at a point",
      description:
        "Scroll the region under coordinate by scroll_amount wheel notches. Needs act access; foreground needs full control.",
      input: Schema.Struct({
        ...WindowRef,
        coordinate: Coordinate,
        scroll_direction: Schema.Literals(["up", "down", "left", "right"]),
        scroll_amount: Schema.optional(
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
        ),
        delivery: Delivery,
      }),
      readOnly: false,
      run: (input, context) =>
        windowAction(
          services,
          context,
          input,
          { scope: scopeFor(input.delivery), action: "click" },
          {
            tool: "scroll",
            args: {
              pid: input.pid,
              window_id: input.window_id,
              x: input.coordinate[0],
              y: input.coordinate[1],
              direction: input.scroll_direction,
              amount: input.scroll_amount ?? 3,
              delivery_mode: input.delivery ?? "background",
            },
          },
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
        windowAction(
          services,
          context,
          input,
          { scope: scopeFor(input.delivery), action: "input" },
          {
            tool: "type_text",
            args: {
              pid: input.pid,
              window_id: input.window_id,
              text: input.text,
              delivery_mode: input.delivery ?? "background",
            },
          },
        ),
    }),
    computerTool(services, {
      name: "computer_key",
      title: "Press a key",
      description:
        'Press a key or "+"-joined chord in the window, e.g. "return", "escape", "tab", "down", "cmd+a", "cmd+shift+z". Needs act access; foreground needs full control.',
      input: Schema.Struct({
        ...WindowRef,
        text: Schema.String.annotate({ description: "The key or chord." }),
        delivery: Delivery,
      }),
      readOnly: false,
      run: (input, context) =>
        Effect.suspend(() => {
          const key = keyCall(input.text);
          return windowAction(
            services,
            context,
            input,
            { scope: scopeFor(input.delivery), action: "input" },
            {
              tool: key.tool,
              args: {
                pid: input.pid,
                window_id: input.window_id,
                delivery_mode: input.delivery ?? "background",
                ...key.args,
              },
            },
          );
        }),
    }),
  ];
}
