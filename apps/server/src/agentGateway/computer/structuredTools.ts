import { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { Effect, Option, Schema } from "effect";

import { appCategory, type ActionClass } from "../../computer/appCategories.ts";
import { scopeCovers } from "../../computer/computerGrants.ts";
import { CuaListApps, CuaListWindows, resultText } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import { untrustedContent } from "../untrustedContent.ts";
import { keyCall, performAction } from "./computerActions.ts";
import {
  appContent,
  callCua,
  callerThread,
  computerTool,
  imageContent,
  refuse,
  windowFor,
  windowLine,
  type ComputerToolServices,
} from "./computerCalls.ts";
import { renderElements, sheetLines } from "./elementText.ts";
import { makeFileDialogTool } from "./fileDialogTool.ts";
import { invokeMenu } from "./menuInvoke.ts";
import { makeVerifyTool } from "./verifyTool.ts";
import { readWindow } from "./windowRead.ts";

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
    Schema.Int.annotate({
      description:
        "Element index from computer_window_state or an action's change list; indexes stay valid while the element exists.",
    }),
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
    Schema.Union([
      Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
      Schema.String.check(Schema.isMinLength(1)),
    ]).annotate({
      description:
        'menu: titles from the menu bar down, as ["File", "Save As…"] or "File > Save As…". Case, a trailing "…" and shortcut suffixes do not matter.',
    }),
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

const ACCESS_WAIT_MS = 45_000;

// Plain clicks and scrolling are click-class; everything that enters text, opens context menus
// or runs menu commands is input-class (see appCategories).
const ACT_CLASS: Record<(typeof ACT_ACTIONS)[number], ActionClass> = {
  click: "click",
  double_click: "click",
  scroll: "click",
  right_click: "input",
  type: "input",
  press: "input",
  set_value: "input",
  menu: "input",
};

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

// computer_apps marks apps whose category caps every grant.
const CATEGORY_NOTE = {
  browser: " [browser: read only, use browser_* tools]",
  terminal_or_ide: " [terminal or IDE: click and scroll only unless full control]",
  other: "",
} as const;

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
          const category = appCategory({
            name: app.name,
            bundleId: app.bundle_id ?? null,
            launchPath: app.launch_path ?? null,
          });
          const own = windows
            .filter((window) => window.pid === app.pid)
            .map(
              (window) =>
                `  window ${window.window_id} ${JSON.stringify(window.title)}${window.is_on_screen ? "" : " (off screen)"}${window.minimized ? " (minimized)" : ""}`,
            );
          return [
            `${app.name} pid ${app.pid}${app.active ? " (frontmost)" : ""}${CATEGORY_NOTE[category]}`,
            ...own,
          ].join("\n");
        });
        const text =
          lines.length > 0
            ? `${lines.length} running ${lines.length === 1 ? "app" : "apps"}.\n${untrustedContent("APP_CONTENT", "source=computer_apps", lines.join("\n"))}`
            : "No running apps.";
        return { content: [{ type: "text", text }] };
      }),
  });

  const windowState = computerTool(services, {
    name: "computer_window_state",
    title: "Read a window",
    description:
      'Accessibility tree of one window: one line per element, `[index] role "label" = value`, long text cut to an excerpt with its length. Attached sheets (Save panels, alerts) are named first and listed in the tree; the menu bar is one line of menu titles. Act on elements by index with computer_act; an index keeps meaning the same element across reads and actions until the element disappears. include_screenshot adds a JPEG only when the tree is not enough. Needs read access.',
    input: WindowStateInput,
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(services, context, input, {
          scope: "read",
          action: "read",
        });
        const read = yield* readWindow(services, context, input, {
          ...(input.query ? { query: input.query } : {}),
          ...(input.max_depth ? { maxDepth: input.max_depth } : {}),
          screenshot: input.include_screenshot ? "return" : "none",
        });
        const header = `${window.app_name} window ${window.window_id} ${JSON.stringify(window.title)}`;
        const tree =
          read.elements.length > 0 ? renderElements(read.elements) : resultText(read.result);
        const image = input.include_screenshot
          ? yield* imageContent(services, context, read.result)
          : [];
        return {
          content: [
            {
              type: "text",
              text: [
                ...read.notes,
                ...sheetLines(read.elements),
                appContent(window, `${header}\n${tree}`),
                windowLine(window),
              ].join("\n"),
            },
            ...image,
          ],
        };
      }),
  });

  const act = computerTool(services, {
    name: "computer_act",
    title: "Act on a window",
    description:
      "Act through the accessibility tree: click, double_click, right_click or set_value an element; type text (into element or the focused field); press a key or chord; scroll (element or window); menu runs a menu bar item by path (an unknown title returns the titles available at that level). Delivery is background unless foreground is asked. The result reports Cua's effect (confirmed, partial, unverifiable, suspected_noop, refused), what changed in the window since you last read it, and any escalation. Needs act access; foreground needs full control. Browsers are read-only; terminals and IDEs take only click and scroll without full control.",
    input: ActInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(services, context, input, {
          scope: input.delivery === "foreground" ? "full" : "act",
          action: ACT_CLASS[input.action],
        });
        const token =
          input.element === undefined
            ? undefined
            : services.access.snapshots.token(
                callerThread(context),
                { pid: input.pid, windowId: input.window_id },
                input.element,
              );
        if (token === null) {
          return yield* refuse(
            "unknown_element",
            `Element ${input.element} is not in this window's latest tree. Read the window again with computer_window_state.`,
          );
        }
        const call = actCall(input, token);
        if (typeof call === "string") return yield* refuse("invalid_input", call);
        return input.action === "menu" && input.menu_path !== undefined
          ? yield* performAction(
              services,
              context,
              input,
              window,
              call,
              invokeMenu(services, context, input, input.menu_path),
            )
          : yield* performAction(services, context, input, window, call);
      }),
  });

  const requestAccess = computerTool(services, {
    name: "computer_request_access",
    title: "Request Computer Use access",
    description:
      "Ask the user for access to an app (or one window): read, act or full. Call it only after a tool returned access_required; other tools grant access on first use when the chat's permission mode allows. Shows a card in the chat and waits up to 45 s. If the answer is pending, call again with the same app to keep waiting; never act on the app before it is granted. A denial is final for this thread unless the user asks again. Browsers can only be granted read.",
    input: RequestAccessInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        if (input.scope !== "read") {
          const listed = yield* callCua(services, context, "list_apps", {});
          const app = Schema.decodeUnknownOption(CuaListApps)(listed.structuredContent).pipe(
            Option.flatMap((value) =>
              Option.fromNullishOr(
                value.apps.find((entry) => entry.name.toLowerCase() === input.app.toLowerCase()),
              ),
            ),
          );
          if (
            Option.isSome(app) &&
            appCategory({
              name: app.value.name,
              bundleId: app.value.bundle_id ?? null,
              launchPath: app.value.launch_path ?? null,
            }) === "browser"
          ) {
            return yield* refuse(
              "browser_read_only",
              `${input.app} is a web browser, which Computer Use can only read. Do web work with the browser_* tools in Glade's own browser, or request scope "read" to look at it.`,
            );
          }
        }
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
            ? scopeCovers(outcome.scope, input.scope)
              ? `Granted: ${outcome.scope} access to ${input.app}.`
              : `Granted: ${outcome.scope} access to ${input.app}. The user chose ${outcome.scope}, not ${input.scope}; work within it and do not ask again.`
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

  return [
    apps,
    windowState,
    act,
    makeFileDialogTool(services),
    makeVerifyTool(services),
    requestAccess,
    stop,
  ];
}
