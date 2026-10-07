import { Effect, Option, Schema } from "effect";

import { appCategory } from "../../computer/appCategories.ts";
import { CuaDesktopTree, CuaListApps } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import { untrustedContent } from "../untrustedContent.ts";
import { callCua, computerTool, type ComputerToolServices } from "./computerCalls.ts";

// Apps whose category caps every grant are marked.
const CATEGORY_NOTE = {
  browser: " [browser: read only, use browser_* tools]",
  terminal_or_ide: " [terminal or IDE: click and scroll only unless full control]",
  other: "",
} as const;

// A desktop overview from Cua's get_accessibility_tree, which is fast and needs no permission:
// running regular apps and their on-screen windows, front to back. Installed apps that are not
// running come from list_apps, which walks the application folders, so only on request.
export const makeAppsTool = (services: ComputerToolServices): ToolEntry =>
  computerTool(services, {
    name: "computer_apps",
    title: "List apps and windows",
    description:
      "Running apps and their on-screen windows, front to back, with the pid and window_id other computer_* tools take (or name the app instead). installed: true also lists apps that are not running, for computer_open_app. Needs no access grant.",
    input: Schema.Struct({ installed: Schema.optionalKey(Schema.Boolean) }),
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const tree = Schema.decodeUnknownOption(CuaDesktopTree)(
          (yield* callCua(services, context, "get_accessibility_tree", {})).structuredContent,
        ).pipe(Option.getOrElse(() => ({ apps: [], windows: [] })));
        const frontPid = tree.windows.find((window) =>
          tree.apps.some((app) => app.pid === window.pid),
        )?.pid;
        // Apps with a window first, in the order of their frontmost window.
        const rank = (pid: number) => {
          const index = tree.windows.findIndex((window) => window.pid === pid);
          return index === -1 ? tree.windows.length : index;
        };
        const lines = tree.apps
          .toSorted((left, right) => rank(left.pid) - rank(right.pid))
          .map((app) => {
            const category = appCategory({
              name: app.name,
              bundleId: app.bundle_id ?? null,
              launchPath: null,
            });
            return [
              `${app.name} pid ${app.pid}${app.pid === frontPid ? " (frontmost)" : ""}${CATEGORY_NOTE[category]}`,
              ...tree.windows
                .filter((window) => window.pid === app.pid)
                .map((window) => `  window ${window.window_id} ${JSON.stringify(window.title)}`),
            ].join("\n");
          });
        const installed = input.installed
          ? Schema.decodeUnknownOption(CuaListApps)(
              (yield* callCua(services, context, "list_apps", {})).structuredContent,
            ).pipe(
              Option.map((value) =>
                value.apps
                  .filter((app) => !app.running)
                  .map((app) => app.name)
                  .toSorted((left, right) => left.localeCompare(right)),
              ),
              Option.getOrElse((): string[] => []),
            )
          : [];
        const content = [
          ...lines,
          ...(installed.length > 0 ? [`Installed, not running: ${installed.join(", ")}`] : []),
        ];
        const text =
          content.length > 0
            ? `${lines.length} running ${lines.length === 1 ? "app" : "apps"}.\n${untrustedContent("APP_CONTENT", "source=computer_apps", content.join("\n"))}`
            : "No running apps.";
        return { content: [{ type: "text", text }] };
      }),
  });
