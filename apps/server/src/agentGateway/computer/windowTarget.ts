import { Effect, Option, Schema } from "effect";

import { CuaListApps, type CuaWindow } from "../../computer/cuaResults.ts";
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

// Apps whose name, bundle id or executable is the query, ignoring case and a trailing ".app" or
// ".exe" (Windows lists running apps by process image, "msedge.exe", unless Cua matched an installed
// entry, "Microsoft Edge"); a running entry first, so it wins over an installed copy with the same
// name.
export const matchApps = (apps: ReadonlyArray<ListedApp>, query: string) => {
  const wanted = appKey(query);
  const executable = (path: string | null | undefined) =>
    path ? appKey(path.split(/[\\/]/u).pop() ?? "") : null;
  return apps
    .filter(
      (app) =>
        appKey(app.name) === wanted ||
        app.bundle_id?.toLowerCase() === wanted ||
        executable(app.launch_path) === wanted,
    )
    .toSorted((left, right) => Number(right.running) - Number(left.running));
};

// The window an app shows in front: the highest on-screen, unminimized window, else any window.
const frontmost = (windows: ReadonlyArray<CuaWindow>) => {
  const byZ = windows.toSorted((left, right) => (right.z_index ?? -1) - (left.z_index ?? -1));
  return byZ.find((window) => window.is_on_screen && window.minimized !== true) ?? byZ[0] ?? null;
};

const resolveApp = (services: ComputerToolServices, context: ToolContext, query: string) =>
  Effect.gen(function* () {
    const listed = yield* callCua(services, context, "list_apps", {});
    const app = Schema.decodeUnknownOption(CuaListApps)(listed.structuredContent).pipe(
      Option.flatMap((value) => Option.fromNullishOr(matchApps(value.apps, query)[0])),
    );
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
