import { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { Effect, Option, Schema } from "effect";

import { appCategory } from "../../computer/appCategories.ts";
import { scopeCovers } from "../../computer/computerGrants.ts";
import { CuaListApps, CuaListWindows, resultText } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import {
  appContent,
  callCua,
  callerThread,
  computerTool,
  imageContent,
  refuse,
  SCREENSHOT_MAX_EDGE,
  windowLine,
  type ComputerToolServices,
} from "./computerCalls.ts";
import { renderElements, sheetLines } from "./elementText.ts";
import { makeAppsTool } from "./appsTool.ts";
import { makeClipboardTools } from "./clipboardTools.ts";
import { makeFileDialogTool } from "./fileDialogTool.ts";
import { makeOpenAppTool } from "./openAppTool.ts";
import { makeVerifyTool } from "./verifyTool.ts";
import { makeWindowFrameTool } from "./windowFrameTool.ts";
import { readWindow } from "./windowRead.ts";
import { targetFor, WindowTarget } from "./windowTarget.ts";

const WindowStateInput = Schema.Struct({
  ...WindowTarget,
  query: Schema.optionalKey(
    Schema.String.annotate({ description: "Keep only elements whose text matches." }),
  ),
  max_depth: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 }))),
  include_screenshot: Schema.optionalKey(Schema.Boolean),
});

const ScreenshotInput = Schema.Struct({
  ...WindowTarget,
  region: Schema.optionalKey(
    Schema.Array(Schema.Finite).check(Schema.isMinLength(4), Schema.isMaxLength(4)).annotate({
      description:
        "[x0, y0, x1, y1] of the latest screenshot to zoom into; coordinates stay in the full screenshot's space.",
    }),
  ),
});

const RequestAccessInput = Schema.Struct({
  app: Schema.String.annotate({ description: "App name exactly as computer_apps lists it." }),
  window_id: Schema.optionalKey(
    Schema.Int.annotate({ description: "Narrow the request to one window." }),
  ),
  scope: ComputerAccessScope.annotate({
    description: "read: see it; act: background input; full: foreground control.",
  }),
  reason: Schema.String.annotate({ description: "One sentence the user sees on the card." }),
});

const ACCESS_WAIT_MS = 45_000;

export function makeStructuredComputerTools(services: ComputerToolServices): ToolEntry[] {
  const windowState = computerTool(services, {
    name: "computer_window_state",
    title: "Read a window",
    description:
      'Accessibility tree of one window: one line per element, `[index] role "label" = value`, long text cut to an excerpt with its length. Attached sheets (Save panels, alerts) are named first and listed in the tree; the menu bar is one line of menu titles. Act on elements by index (element_index in the input tools); an index keeps meaning the same element across reads and actions until the element disappears. include_screenshot adds a JPEG only when the tree is not enough. Needs read access.',
    input: WindowStateInput,
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const { target, window } = yield* targetFor(services, context, input, {
          scope: "read",
          action: "read",
        });
        const read = yield* readWindow(services, context, target, {
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

  const screenshot = computerTool(services, {
    name: "computer_screenshot",
    title: "Screenshot a window",
    description: `JPEG of one window only, at most ${SCREENSHOT_MAX_EDGE} px on the long edge; coordinate inputs are pixels of this image. With region, a close-up of part of it for small text (Anthropic's zoom). Use it when the accessibility tree lacks the target or an effect is unverifiable. Needs read access.`,
    input: ScreenshotInput,
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const { target } = yield* targetFor(services, context, input, {
          scope: "read",
          action: "read",
        });
        const result = input.region
          ? yield* callCua(services, context, "zoom", {
              ...target,
              x1: input.region[0],
              y1: input.region[1],
              x2: input.region[2],
              y2: input.region[3],
            })
          : yield* callCua(services, context, "get_window_state", {
              ...target,
              include_accessibility_tree: false,
              max_image_dimension: SCREENSHOT_MAX_EDGE,
            });
        return { content: yield* imageContent(services, context, result) };
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
    makeAppsTool(services),
    makeOpenAppTool(services),
    windowState,
    screenshot,
    // The tool drives the macOS Open and Save panel only.
    ...(process.platform === "darwin" ? [makeFileDialogTool(services)] : []),
    makeVerifyTool(services),
    ...makeClipboardTools(services),
    makeWindowFrameTool(services),
    requestAccess,
    stop,
  ];
}
