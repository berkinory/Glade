import { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { Effect, Option, Schema } from "effect";

import {
  CuaListApps,
  CuaListWindows,
  CuaWindowState,
  resultText,
  type CuaElement,
} from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import {
  actionContent,
  callCua,
  callerThread,
  computerTool,
  imageContent,
  keyCall,
  refuse,
  SCREENSHOT_MAX_EDGE,
  windowFor,
  type ComputerToolServices,
} from "./computerCalls.ts";

const WindowRef = {
  pid: Schema.Int.annotate({ description: "Process id from computer_apps." }),
  window_id: Schema.Int.annotate({ description: "Window id from computer_apps." }),
};
const Delivery = Schema.optional(
  Schema.Literals(["background", "foreground"]).annotate({
    description:
      "background (default) acts without taking focus; foreground briefly fronts the window and needs full control.",
  }),
);

const WindowStateInput = Schema.Struct({
  ...WindowRef,
  query: Schema.optional(
    Schema.String.annotate({ description: "Keep only elements whose text matches." }),
  ),
  max_depth: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 }))),
  include_screenshot: Schema.optional(Schema.Boolean),
});

const ACT_ACTIONS = [
  "click",
  "double_click",
  "right_click",
  "type",
  "press",
  "scroll",
  "set_value",
  "menu",
] as const;

const ActInput = Schema.Struct({
  ...WindowRef,
  action: Schema.Literals(ACT_ACTIONS),
  element: Schema.optional(
    Schema.Int.annotate({ description: "Element index from the latest computer_window_state." }),
  ),
  text: Schema.optional(Schema.String.annotate({ description: "type: text to insert." })),
  key: Schema.optional(
    Schema.String.annotate({
      description: 'press: a key ("return", "escape", "down") or a chord ("cmd+s").',
    }),
  ),
  value: Schema.optional(Schema.String.annotate({ description: "set_value: the new value." })),
  direction: Schema.optional(Schema.Literals(["up", "down", "left", "right"])),
  amount: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  menu_path: Schema.optional(
    Schema.Array(Schema.String)
      .check(Schema.isMinLength(1), Schema.isMaxLength(16))
      .annotate({ description: 'menu: labels from the menu bar down, e.g. ["File", "Save"].' }),
  ),
  delivery: Delivery,
});

const RequestAccessInput = Schema.Struct({
  app: Schema.String.annotate({ description: "App name exactly as computer_apps lists it." }),
  window_id: Schema.optional(
    Schema.Int.annotate({ description: "Narrow the request to one window." }),
  ),
  scope: ComputerAccessScope.annotate({
    description: "read: see it; act: background input; full: foreground control.",
  }),
  reason: Schema.String.annotate({ description: "One sentence the user sees on the card." }),
});

const MAX_TREE_CHARS = 24_000;
const ACCESS_WAIT_MS = 45_000;

const valueText = (element: CuaElement) => {
  const { value } = element;
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === element.label) return "";
  return ` = ${JSON.stringify(text.length > 120 ? `${text.slice(0, 120)}…` : text)}`;
};

function renderElements(elements: ReadonlyArray<CuaElement>): string {
  const lines: string[] = [];
  let length = 0;
  for (const element of elements) {
    const label = element.label ? ` ${JSON.stringify(element.label)}` : "";
    const states = `${element.enabled === false ? " (disabled)" : ""}${element.selected ? " (selected)" : ""}`;
    const line = `${"  ".repeat(element.depth ?? 0)}[${element.element_index}] ${element.role}${label}${valueText(element)}${states}`;
    if (length + line.length > MAX_TREE_CHARS) {
      lines.push(
        `… ${elements.length - lines.length} more elements; narrow with query or max_depth.`,
      );
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

// The Cua tool and arguments for one computer_act, or why the input cannot form one.
function actCall(
  input: typeof ActInput.Type,
  elementToken: string | undefined,
): { readonly tool: string; readonly args: Record<string, unknown> } | string {
  const base = {
    pid: input.pid,
    window_id: input.window_id,
    ...(elementToken ? { element_token: elementToken } : {}),
  };
  const delivered = { ...base, delivery_mode: input.delivery ?? "background" };
  const missing = (field: string) => `computer_act ${input.action} needs ${field}.`;
  switch (input.action) {
    case "click":
    case "double_click":
    case "right_click":
      return elementToken ? { tool: input.action, args: delivered } : missing("element");
    case "set_value":
      if (!elementToken) return missing("element");
      return input.value === undefined
        ? missing("value")
        : { tool: "set_value", args: { ...base, value: input.value } };
    case "type":
      return input.text === undefined
        ? missing("text")
        : { tool: "type_text", args: { ...delivered, text: input.text } };
    case "press": {
      if (input.key === undefined) return missing("key");
      const key = keyCall(input.key);
      return { tool: key.tool, args: { ...delivered, ...key.args } };
    }
    case "scroll":
      return input.direction === undefined
        ? missing("direction")
        : {
            tool: "scroll",
            args: { ...delivered, direction: input.direction, amount: input.amount ?? 3 },
          };
    case "menu":
      return input.menu_path === undefined
        ? missing("menu_path")
        : {
            tool: "invoke_menu",
            args: { pid: input.pid, window_id: input.window_id, path: input.menu_path },
          };
  }
}

export function makeStructuredComputerTools(services: ComputerToolServices): ToolEntry[] {
  const apps = computerTool(services, {
    name: "computer_apps",
    title: "List apps and windows",
    description:
      "Running apps and their windows with the pid and window_id every other computer_* tool takes. Needs no access grant.",
    input: Schema.Struct({}),
    readOnly: true,
    run: (_input, context) =>
      Effect.gen(function* () {
        const [appsResult, windowsResult] = yield* Effect.all([
          callCua(services, context, "list_apps", {}),
          callCua(services, context, "list_windows", {}),
        ]);
        const running = Schema.decodeUnknownOption(CuaListApps)(appsResult.structuredContent).pipe(
          Option.map((value) => value.apps.filter((app) => app.running)),
          Option.getOrElse(() => []),
        );
        const windows = Schema.decodeUnknownOption(CuaListWindows)(
          windowsResult.structuredContent,
        ).pipe(
          Option.map((value) => value.windows),
          Option.getOrElse(() => []),
        );
        const lines = running.map((app) => {
          const own = windows
            .filter((window) => window.pid === app.pid)
            .map(
              (window) =>
                `  window ${window.window_id} ${JSON.stringify(window.title)}${window.is_on_screen ? "" : " (off screen)"}${window.minimized ? " (minimized)" : ""}`,
            );
          return [`${app.name} pid ${app.pid}${app.active ? " (frontmost)" : ""}`, ...own].join(
            "\n",
          );
        });
        return { content: [{ type: "text", text: lines.join("\n") || "No running apps." }] };
      }),
  });

  const windowState = computerTool(services, {
    name: "computer_window_state",
    title: "Read a window",
    description:
      'Accessibility tree of one window: one line per element, `[index] role "label" = value`. Act on elements by index with computer_act; indexes are valid until the next computer_window_state of that window. include_screenshot adds a JPEG only when the tree is not enough. Needs read access.',
    input: WindowStateInput,
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(services, context, input, "read");
        const result = yield* callCua(services, context, "get_window_state", {
          pid: input.pid,
          window_id: input.window_id,
          include_screenshot: input.include_screenshot === true,
          max_image_dimension: SCREENSHOT_MAX_EDGE,
          ...(input.query ? { query: input.query } : {}),
          ...(input.max_depth ? { max_depth: input.max_depth } : {}),
        });
        const state = Schema.decodeUnknownOption(CuaWindowState)(result.structuredContent);
        const elements = Option.match(state, {
          onNone: () => [] as ReadonlyArray<CuaElement>,
          onSome: (value) => value.elements ?? [],
        });
        services.access.tasks.rememberElements(
          callerThread(context),
          { pid: input.pid, windowId: input.window_id },
          new Map(elements.map((element) => [element.element_index, element.element_token])),
        );
        const notes = Option.match(state, {
          onNone: () => [],
          onSome: (value) => [
            ...(value.truncated ? ["The tree was truncated; narrow with query or max_depth."] : []),
            ...(value.degraded_reason ? [`Degraded: ${value.degraded_reason}.`] : []),
          ],
        });
        const header = `${window.app_name} window ${window.window_id} ${JSON.stringify(window.title)}`;
        const tree = elements.length > 0 ? renderElements(elements) : resultText(result);
        const image = input.include_screenshot
          ? yield* imageContent(services, context, result)
          : [];
        return {
          content: [{ type: "text", text: [header, ...notes, tree].join("\n") }, ...image],
        };
      }),
  });

  const act = computerTool(services, {
    name: "computer_act",
    title: "Act on a window",
    description:
      "Act through the accessibility tree: click, double_click, right_click or set_value an element; type text (into element or the focused field); press a key or chord; scroll (element or window); menu runs a menu bar item by path. Delivery is background unless foreground is asked. The result reports Cua's effect (confirmed, partial, unverifiable, suspected_noop, refused) and any escalation. Needs act access; foreground needs full control.",
    input: ActInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(
          services,
          context,
          input,
          input.delivery === "foreground" ? "full" : "act",
        );
        const token =
          input.element === undefined
            ? undefined
            : services.access.tasks.elementToken(
                callerThread(context),
                { pid: input.pid, windowId: input.window_id },
                input.element,
              );
        if (token === null) {
          return yield* refuse(
            "unknown_element",
            `Element ${input.element} is not in this window's latest computer_window_state. Read the window again.`,
          );
        }
        const call = actCall(input, token);
        if (typeof call === "string") return yield* refuse("invalid_input", call);
        return actionContent(yield* callCua(services, context, call.tool, call.args), window);
      }),
  });

  const requestAccess = computerTool(services, {
    name: "computer_request_access",
    title: "Request Computer Use access",
    description:
      "Ask the user for access to an app (or one window) before acting on it: read, act or full. Shows a card in the chat and waits up to 45 s. If the answer is pending, call again with the same app to keep waiting; never act on the app before it is granted. A denial is final for this thread unless the user asks again.",
    input: RequestAccessInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const windowTitle =
          input.window_id === undefined
            ? null
            : yield* Effect.gen(function* () {
                const listed = yield* callCua(services, context, "list_windows", {});
                return Schema.decodeUnknownOption(CuaListWindows)(listed.structuredContent).pipe(
                  Option.flatMap((value) =>
                    Option.fromNullishOr(
                      value.windows.find((window) => window.window_id === input.window_id),
                    ),
                  ),
                  Option.map((window) => window.title),
                  Option.getOrNull,
                );
              });
        const outcome = yield* services.access.requestAccess({
          threadId: callerThread(context),
          turnId: context.callerTurnId,
          app: input.app,
          windowId: input.window_id ?? null,
          windowTitle,
          scope: input.scope,
          reason: input.reason,
          waitMs: ACCESS_WAIT_MS,
        });
        const text =
          outcome.status === "granted"
            ? `Granted: ${outcome.scope} access to ${input.app}.`
            : outcome.status === "denied"
              ? `The user denied access to ${input.app}. Do not use it or ask again unless the user says so.`
              : `Waiting for the user to answer the access card. Call computer_request_access again with app "${input.app}" to keep waiting; do not act on it yet.`;
        return {
          content: [{ type: "text", text }],
          ...(outcome.status === "denied" ? { isError: true } : {}),
        };
      }),
  });

  const stop = computerTool(services, {
    name: "computer_stop",
    title: "Finish Computer Use",
    description:
      "End this thread's Computer Use session when the task is done: releases any held keys or buttons and hides the agent cursor.",
    input: Schema.Struct({}),
    readOnly: false,
    run: (_input, context) =>
      services.host
        .endSession(callerThread(context))
        .pipe(Effect.as({ content: [{ type: "text", text: "Computer Use session ended." }] })),
  });

  return [apps, windowState, act, requestAccess, stop];
}
