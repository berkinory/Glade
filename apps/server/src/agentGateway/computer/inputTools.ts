import { Effect, Schema } from "effect";

import type { ActionClass } from "../../computer/appCategories.ts";
import type { CuaToolResult } from "../../computer/cuaResults.ts";
import type { GatewayToolError, ToolContext, ToolEntry } from "../toolRuntime.ts";
import { performAction, type CuaCall } from "./computerActions.ts";
import {
  callCua,
  callerThread,
  computerTool,
  refuse,
  type ComputerToolServices,
  type WindowInput,
} from "./computerCalls.ts";
import { keyCalls, selectionCalls, TEXT_SELECTIONS } from "./keyChords.ts";
import { invokeMenu } from "./menuInvoke.ts";
import { targetFor, WindowTarget, type WindowTargetInput } from "./windowTarget.ts";

// One tool per action, as Anthropic's computer toolset and Codex/Cua name them. Each addresses an
// element by its Glade index from computer_window_state (preferred) or a point in the window's
// latest screenshot; the grant, app category, progress guard and user yield all run through
// targetFor and performAction, never per tool.

type DeliveryMode = "background" | "foreground";

const ElementIndex = Schema.optionalKey(
  Schema.Int.annotate({ description: "Element index from computer_window_state." }),
);
const pair = (description: string) =>
  Schema.Array(Schema.Finite)
    .check(Schema.isMinLength(2), Schema.isMaxLength(2))
    .annotate({ description });
const Coordinate = pair("[x, y] in the window's latest screenshot; instead of element_index.");
const Delivery = Schema.optionalKey(
  Schema.Literals(["background", "foreground"]).annotate({
    description: "background (default) acts without focus; foreground needs full control.",
  }),
);
const Located = {
  ...WindowTarget,
  element_index: ElementIndex,
  coordinate: Schema.optionalKey(Coordinate),
};
const Modifiers = Schema.optionalKey(
  Schema.String.annotate({
    description:
      'Modifiers held during the click, e.g. "cmd+shift"; sent in the foreground (full control).',
  }),
);

interface LocatedInput extends WindowTargetInput {
  readonly element_index?: number | undefined;
  readonly coordinate?: ReadonlyArray<number> | undefined;
}

// Where an input lands in Cua's terms: an element token, a screenshot point, or the window's focus.
type Where =
  | { readonly kind: "element"; readonly args: { readonly element_token: string } }
  | { readonly kind: "point"; readonly args: { readonly x: number; readonly y: number } }
  | { readonly kind: "focus"; readonly args: Record<string, never> };

interface InputPlan {
  readonly action: ActionClass;
  // null for tools without a delivery choice (set_value, menu).
  readonly delivery: DeliveryMode | null;
  // Drags carry their own points, so their coordinate is not a target.
  readonly unlocated?: boolean;
  // The Cua call(s), or why this input cannot form one. Several calls run in order (key sequences).
  readonly build: (
    base: { readonly pid: number; readonly window_id: number },
    where: Where,
  ) => CuaCall | ReadonlyArray<CuaCall> | string;
  readonly run?: (target: WindowInput) => Effect.Effect<CuaToolResult, GatewayToolError>;
  // Leads the result of several calls instead of the key count.
  readonly summary?: string;
}

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
    .split(/[\s+,]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .map((part) => MODIFIER_NAMES[part] ?? part);

export function makeInputComputerTools(services: ComputerToolServices): ToolEntry[] {
  const locate = (context: ToolContext, target: WindowInput, input: LocatedInput) => {
    if (input.element_index !== undefined && input.coordinate !== undefined) {
      return refuse("invalid_input", "Pass element_index or coordinate, not both.");
    }
    if (input.coordinate !== undefined) {
      const [x, y] = input.coordinate as [number, number];
      return Effect.succeed<Where>({ kind: "point", args: { x, y } });
    }
    if (input.element_index === undefined) {
      return Effect.succeed<Where>({ kind: "focus", args: {} });
    }
    const token = services.access.snapshots.token(
      callerThread(context),
      { pid: target.pid, windowId: target.window_id },
      input.element_index,
    );
    return token === null
      ? refuse(
          "unknown_element",
          `Element ${input.element_index} is not in this window's latest tree. Read the window again with computer_window_state.`,
        )
      : Effect.succeed<Where>({ kind: "element", args: { element_token: token } });
  };

  const perform = (input: LocatedInput, context: ToolContext, plan: InputPlan) =>
    Effect.gen(function* () {
      const { target, window } = yield* targetFor(services, context, input, {
        scope: plan.delivery === "foreground" ? "full" : "act",
        action: plan.action,
      });
      const where = plan.unlocated
        ? ({ kind: "focus", args: {} } as const)
        : yield* locate(context, target, input);
      const base = {
        pid: target.pid,
        window_id: target.window_id,
        ...(plan.delivery ? { delivery_mode: plan.delivery } : {}),
      };
      const built = plan.build(base, where);
      if (typeof built === "string") return yield* refuse("invalid_input", built);
      const calls: ReadonlyArray<CuaCall> = "tool" in built ? [built] : built;
      const run =
        plan.run?.(target) ??
        Effect.forEach(calls, (call) => callCua(services, context, call.tool, call.args)).pipe(
          Effect.map((results): CuaToolResult => {
            const last = results.at(-1)!;
            return calls.length === 1 && !plan.summary
              ? last
              : {
                  ...last,
                  content: [
                    {
                      type: "text",
                      text: plan.summary ?? `Sent ${calls.length} keys in order; the last:`,
                    },
                    ...last.content,
                  ],
                };
          }),
        );
      return yield* performAction(
        services,
        context,
        { ...input, ...target },
        window,
        calls[0]!,
        run,
      );
    });

  const needsTarget = (where: Where, name: string) =>
    where.kind === "focus" ? `${name} needs element_index or coordinate.` : null;

  const ClickInput = Schema.Struct({ ...Located, text: Modifiers, delivery: Delivery });
  const click = (name: string, title: string, verb: string, tool: string, count?: number) =>
    computerTool(services, {
      name,
      title,
      description: `${verb} an element (element_index) or a screenshot point (coordinate). Needs act access; foreground or modifiers need full control.`,
      input: ClickInput,
      readOnly: false,
      run: (input, context) => {
        const modifier = modifierList(input.text);
        // macOS only sees physical modifier state, so Cua requires foreground for these.
        const delivery = modifier.length > 0 ? "foreground" : (input.delivery ?? "background");
        return perform(input, context, {
          action: tool === "right_click" || modifier.length > 0 ? "input" : "click",
          delivery,
          build: (base, where) => {
            const missing = needsTarget(where, name);
            if (missing) return missing;
            // Cua repeats clicks only on the pixel path.
            if (count && where.kind !== "point") return `${name} needs coordinate.`;
            return {
              tool,
              args: {
                ...base,
                ...where.args,
                ...(modifier.length > 0 ? { modifier } : {}),
                ...(count ? { count } : {}),
              },
            };
          },
        });
      },
    });

  const typeTool = computerTool(services, {
    name: "computer_type",
    title: "Type text",
    description:
      "Insert text into an element (element_index), the field at coordinate, or the window's focused field. Same as Codex type_text. Needs act access.",
    input: Schema.Struct({ ...Located, text: Schema.String, delivery: Delivery }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "input",
        delivery: input.delivery ?? "background",
        build: (base, where) => ({
          tool: "type_text",
          args: { ...base, ...where.args, text: input.text },
        }),
      }),
  });

  const keyTool = computerTool(services, {
    name: "computer_key",
    title: "Press keys",
    description:
      'Press a key or chord in the window (xdotool or "+" syntax: "Return", "cmd+s", "ctrl+shift+z"); space-separated keys run in order ("Down Down Return"). element_index or coordinate focuses that target first. Same as Codex press_key. Needs act access.',
    input: Schema.Struct({
      ...Located,
      text: Schema.String.annotate({ description: "The key, chord or key sequence." }),
      delivery: Delivery,
    }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "input",
        delivery: input.delivery ?? "background",
        build: (base, where) => {
          const keys = keyCalls(input.text);
          if (typeof keys === "string") return keys;
          return keys.map((key, position) => ({
            tool: key.tool,
            args: { ...base, ...(position === 0 ? where.args : {}), ...key.args },
          }));
        },
      }),
  });

  const selectTextTool = computerTool(services, {
    name: "computer_select_text",
    title: "Select text",
    description:
      "Select text from the caret in a text element (element_index) or the window's focused field with key chords sent in the foreground: all, the line, the word, to the start or end, or count characters left or right. Needs full control.",
    input: Schema.Struct({
      ...WindowTarget,
      element_index: ElementIndex,
      select: Schema.Literals(TEXT_SELECTIONS),
      count: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
          description: "Characters for left or right (default 1).",
        }),
      ),
    }),
    readOnly: false,
    run: (input, context) => {
      const keys = selectionCalls(input.select, input.count ?? 1);
      return perform(input, context, {
        action: "input",
        // Cua refuses background keys to an app with several windows (same_pid_keyboard_ambiguity),
        // which is the usual state of a document app.
        delivery: "foreground",
        summary: `Selected ${input.select.replace("_", " ")}; the accessibility tree does not show selections, so zoom in with computer_screenshot to check. The last key:`,
        build: (base, where) =>
          typeof keys === "string"
            ? keys
            : keys.map((key, position) => ({
                tool: key.tool,
                args: { ...base, ...(position === 0 ? where.args : {}), ...key.args },
              })),
      });
    },
  });

  const scrollTool = computerTool(services, {
    name: "computer_scroll",
    title: "Scroll",
    description:
      "Scroll by scroll_amount wheel notches (default 3, about a third of a page each) at an element, a screenshot point, or the window's focused scroller. Needs act access.",
    input: Schema.Struct({
      ...Located,
      scroll_direction: Schema.Literals(["up", "down", "left", "right"]),
      scroll_amount: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
      ),
      delivery: Delivery,
    }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "click",
        delivery: input.delivery ?? "background",
        build: (base, where) => ({
          tool: "scroll",
          args: {
            ...base,
            ...where.args,
            direction: input.scroll_direction,
            amount: input.scroll_amount ?? 3,
          },
        }),
      }),
  });

  const setValueTool = computerTool(services, {
    name: "computer_set_value",
    title: "Set a value",
    description:
      "Set an element's value directly (text field, slider, pop-up, checkbox), replacing what it held. Same as Codex set_value. Needs act access.",
    input: Schema.Struct({
      ...WindowTarget,
      element_index: Schema.Int.annotate({
        description: "Element index from computer_window_state.",
      }),
      value: Schema.String,
    }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "input",
        delivery: null,
        build: (base, where) => ({
          tool: "set_value",
          args: { ...base, ...where.args, value: input.value },
        }),
      }),
  });

  const menuTool = computerTool(services, {
    name: "computer_menu",
    title: "Run a menu command",
    description:
      'Run a menu bar item of the window\'s app by path, e.g. "File > Save As…" or ["Format", "Font", "Bold"]. Case, a trailing "…" and shortcut suffixes do not matter; an unknown title returns the titles at that level. Needs act access.',
    input: Schema.Struct({
      ...WindowTarget,
      menu_path: Schema.Union([
        Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
        Schema.String.check(Schema.isMinLength(1)),
      ]).annotate({ description: 'Titles from the menu bar down, as an array or "A > B".' }),
    }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "input",
        delivery: null,
        build: (base) => ({ tool: "invoke_menu", args: { ...base, path: input.menu_path } }),
        run: (target) => invokeMenu(services, context, target, input.menu_path),
      }),
  });

  const dragTool = computerTool(services, {
    name: "computer_left_click_drag",
    title: "Drag between points",
    description:
      "Press at start_coordinate, drag to coordinate and release (screenshot pixels). The pointer moves for real, so this fronts the window and needs full control.",
    input: Schema.Struct({
      ...WindowTarget,
      start_coordinate: pair("[x, y] where the drag starts."),
      coordinate: pair("[x, y] where it ends."),
    }),
    readOnly: false,
    run: (input, context) =>
      perform(input, context, {
        action: "input",
        delivery: "foreground",
        unlocated: true,
        build: (base) => ({
          tool: "drag",
          args: {
            ...base,
            from_x: input.start_coordinate[0],
            from_y: input.start_coordinate[1],
            to_x: input.coordinate[0],
            to_y: input.coordinate[1],
          },
        }),
      }),
  });

  return [
    click("computer_left_click", "Click", "Left-click", "click"),
    click("computer_right_click", "Right-click", "Right-click", "right_click"),
    click("computer_double_click", "Double-click", "Double-click", "double_click"),
    click("computer_triple_click", "Triple-click", "Triple-click", "click", 3),
    typeTool,
    keyTool,
    selectTextTool,
    scrollTool,
    setValueTool,
    menuTool,
    dragTool,
  ];
}
