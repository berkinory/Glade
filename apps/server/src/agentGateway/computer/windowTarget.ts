import { Effect, Option, Schema } from "effect";

import { CuaListApps, type CuaWindow } from "../../computer/cuaResults.ts";
import { packagedExecutable } from "../../computer/windowsPackages.ts";
import type { ToolContext } from "../toolRuntime.ts";
import {
  appWindows,
  callCua,
  refuse,
  windowFor,
  type ComputerToolServices,
  type WindowInput,
  type WindowNeed,
} from "./computerCalls.ts";

// A window named by pid and window_id, or by its app (the app's frontmost window), which is how
// Codex-trained models address apps (get_app_state({app})).
export const WindowTarget = {
  pid: Schema.optionalKey(Schema.Int.annotate({ description: "Process id from computer_apps." })),
  window_id: Schema.optionalKey(
    Schema.Int.annotate({ description: "Window id from computer_apps." }),
  ),
  app: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "Instead of pid and window_id: app name or bundle id; uses its frontmost window, so pass window_id when it has several.",
    }),
  ),
};

export interface WindowTargetInput {
  readonly pid?: number | undefined;
  readonly window_id?: number | undefined;
  readonly app?: string | undefined;
}

type ListedApp = (typeof CuaListApps.Type)["apps"][number];

const appKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\.(app|exe)$/u, "");

// Windows names a packaged app by its package display name ("Windows Calculator"), the Start menu
// by the app's own name ("Calculator").
const VENDOR_PREFIX = /^(?:windows|microsoft) /u;

// Apps whose name, bundle id or executable is the query, ignoring case and a trailing ".app" or
// ".exe" (Windows lists running apps by process image, "msedge.exe", unless Cua matched an installed
// entry, "Microsoft Edge"), or whose name is the query after a Windows vendor prefix; a running
// entry first, so it wins over an installed copy with the same name.
const matchApps = (apps: ReadonlyArray<ListedApp>, query: string) => {
  const wanted = appKey(query);
  const executable = (path: string | null | undefined) =>
    path ? appKey(path.split(/[\\/]/u).pop() ?? "") : null;
  return apps
    .filter(
      (app) =>
        appKey(app.name) === wanted ||
        appKey(app.name).replace(VENDOR_PREFIX, "") === wanted ||
        app.bundle_id?.toLowerCase() === wanted ||
        executable(app.launch_path) === wanted,
    )
    .toSorted((left, right) => Number(right.running) - Number(left.running));
};

// WinUI hosts an open menu or flyout in its own top-level window, above the app's real window.
const POPUP_HOST_TITLE = "PopupHost";

// The window an app shows in front: the highest on-screen, unminimized window that is not a popup
// host, else any window.
const frontmost = (windows: ReadonlyArray<CuaWindow>) => {
  const byZ = windows.toSorted(
    (left, right) =>
      Number(left.title === POPUP_HOST_TITLE) - Number(right.title === POPUP_HOST_TITLE) ||
      (right.z_index ?? -1) - (left.z_index ?? -1),
  );
  return byZ.find((window) => window.is_on_screen && window.minimized !== true) ?? byZ[0] ?? null;
};

// The listed app the query names, or null. Cua lists a packaged Windows app under its package
// display name ("Windows Calculator") while it is installed and under its process image
// ("CalculatorApp.exe") while it runs, as its windows and grants are named; a match on the
// installed entry resolves to the process image, and to the running process when there is one.
export const findApp = (services: ComputerToolServices, context: ToolContext, query: string) =>
  Effect.gen(function* () {
    const listed = yield* callCua(services, context, "list_apps", {});
    const apps = Schema.decodeUnknownOption(CuaListApps)(listed.structuredContent).pipe(
      Option.map((value) => value.apps),
      Option.getOrElse((): ReadonlyArray<ListedApp> => []),
    );
    const app = matchApps(apps, query)[0];
    if (!app || app.running) return app ?? null;
    const executable = yield* packagedExecutable(app.launch_path ?? null);
    if (executable === null) return app;
    const running = apps.find(
      (entry) => entry.running && appKey(entry.name) === appKey(executable),
    );
    return running
      ? { ...running, bundle_id: app.bundle_id, launch_path: app.launch_path }
      : { ...app, name: executable };
  });

// The name grants and refusals use for a listed app: its windows' app name while it runs, since Cua
// can list a running app under another name ("Microsoft Edge" for msedge.exe windows), else the
// listed name.
export const grantName = (services: ComputerToolServices, context: ToolContext, app: ListedApp) =>
  app.running
    ? appWindows(services, context, app.pid).pipe(
        Effect.map((windows) => windows[0]?.app_name ?? app.name),
      )
    : Effect.succeed(app.name);

const resolveApp = (services: ComputerToolServices, context: ToolContext, query: string) =>
  Effect.gen(function* () {
    const app = Option.fromNullishOr(yield* findApp(services, context, query));
    if (Option.isNone(app) || !app.value.running) {
      return yield* refuse(
        "app_not_found",
        Option.isSome(app)
          ? `${app.value.name} is not running. Start it with computer_open_app.`
          : `No running app is named ${JSON.stringify(query)} or has that bundle id. Call computer_apps for running apps.`,
      );
    }
    const window = frontmost(yield* appWindows(services, context, app.value.pid));
    if (!window) {
      return yield* refuse(
        "window_not_found",
        `${app.value.name} has no windows. Open one (computer_open_app or the app's File menu) first.`,
      );
    }
    return { pid: app.value.pid, window_id: window.window_id } satisfies WindowInput;
  });

const resolveTarget = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowTargetInput,
) => {
  if (input.pid !== undefined && input.window_id !== undefined) {
    return Effect.succeed<WindowInput>({ pid: input.pid, window_id: input.window_id });
  }
  if (input.app !== undefined) return resolveApp(services, context, input.app);
  return refuse("invalid_input", "Name the window with pid and window_id, or with app.");
};

// The authorized window a tool acts on, and its pid/window pair for Cua.
export const targetFor = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowTargetInput,
  need: WindowNeed,
) =>
  Effect.gen(function* () {
    const target = yield* resolveTarget(services, context, input);
    const window = yield* windowFor(services, context, target, need);
    return { target, window };
  });
