import { Effect, Option, Schema } from "effect";

import { appCategory } from "../../computer/appCategories.ts";
import { CuaDesktopTree, CuaListApps, CuaListWindows } from "../../computer/cuaResults.ts";
import type { ToolContext, ToolEntry } from "../toolRuntime.ts";
import { untrustedContent } from "../untrustedContent.ts";
import { callCua, computerTool, refuse, type ComputerToolServices } from "./computerCalls.ts";
import { screenLine } from "./screenGeometry.ts";

// Apps whose category caps every grant are marked.
const CATEGORY_NOTE = {
  browser: " [browser: read only, use browser_* tools]",
  terminal_or_ide: " [terminal or IDE: click and scroll only unless full control]",
  other: "",
} as const;

interface Overview {
  readonly apps: ReadonlyArray<{
    pid: number;
    name: string;
    bundle_id?: string | null | undefined;
  }>;
  readonly windows: ReadonlyArray<{ window_id: number; pid: number | null; title: string }>;
  readonly listed: typeof CuaListApps.Type | null;
}

// A desktop overview from Cua's get_accessibility_tree, which is fast and needs no permission:
// running regular apps and their on-screen windows, front to back. On Linux Cua 0.34 answers it
// with bare processes and windows without app names, so there the running apps that own an
// on-screen window come from list_apps and list_windows, front to back by stacking order.
const desktopOverview = (services: ComputerToolServices, context: ToolContext) =>
  Effect.gen(function* () {
    const tree = Schema.decodeUnknownOption(CuaDesktopTree)(
      (yield* callCua(services, context, "get_accessibility_tree", {})).structuredContent,
    );
    if (Option.isSome(tree)) return { ...tree.value, listed: null } satisfies Overview;
    const [appsResult, windowsResult] = yield* Effect.all([
      callCua(services, context, "list_apps", {}),
      callCua(services, context, "list_windows", {}),
    ]);
    const listed = Schema.decodeUnknownOption(CuaListApps)(appsResult.structuredContent);
    const listedWindows = Schema.decodeUnknownOption(CuaListWindows)(
      windowsResult.structuredContent,
    );
    if (Option.isNone(listed) || Option.isNone(listedWindows)) {
      return yield* refuse("cua_error", "Cua Driver did not return the running apps.");
    }
    const windows = listedWindows.value.windows
      .filter((window) => window.is_on_screen)
      .toSorted((left, right) => (right.z_index ?? 0) - (left.z_index ?? 0));
    // Grants and refusals name an app by its windows' app_name (the X11 window class), so the list
    // uses that name too rather than the desktop entry's.
    const apps = listed.value.apps.flatMap((app) => {
      const window = app.running ? windows.find((entry) => entry.pid === app.pid) : undefined;
      return window ? [{ ...app, name: window.app_name }] : [];
    });
    return {
      apps,
      windows,
      listed: listed.value,
    } satisfies Overview;
  });

// Installed apps that are not running come from list_apps, which walks the application folders,
// so only on request.
export const makeAppsTool = (services: ComputerToolServices): ToolEntry =>
  computerTool(services, {
    name: "computer_apps",
    title: "List apps and windows",
    description:
      "Running apps and their on-screen windows, front to back, with the pid and window_id other computer_* tools take (or name the app instead), and each display's size and work area (without menu bar, dock or taskbar) in the coordinates window bounds use. installed: true also lists apps that are not running, for computer_open_app. Needs no access grant.",
    input: Schema.Struct({ installed: Schema.optionalKey(Schema.Boolean) }),
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const [tree, screen] = yield* Effect.all(
          [desktopOverview(services, context), screenLine(services)],
          { concurrency: "unbounded" },
        );
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
          ? (tree.listed
              ? Option.some(tree.listed)
              : Schema.decodeUnknownOption(CuaListApps)(
                  (yield* callCua(services, context, "list_apps", {})).structuredContent,
                )
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
        const text = [
          screen,
          content.length > 0
            ? `${lines.length} running ${lines.length === 1 ? "app" : "apps"}.\n${untrustedContent("APP_CONTENT", "source=computer_apps", content.join("\n"))}`
            : "No running apps.",
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }),
  });
