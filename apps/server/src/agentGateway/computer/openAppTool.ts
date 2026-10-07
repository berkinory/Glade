import { Effect, Option, Schema } from "effect";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";

import { launchRefusal, type AppIdentity } from "../../computer/appCategories.ts";
import { CuaLaunchedApp, CuaListApps, type CuaWindow } from "../../computer/cuaResults.ts";
import type { ToolContext, ToolEntry } from "../toolRuntime.ts";
import { untrustedContent } from "../untrustedContent.ts";
import {
  appWindows,
  callCua,
  callerThread,
  computerTool,
  refuse,
  windowLine,
  windowSummary,
  type ComputerToolServices,
} from "./computerCalls.ts";
import { matchApps } from "./windowTarget.ts";

const OpenAppInput = Schema.Struct({
  app: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'App name ("TextEdit") or bundle id ("com.apple.TextEdit").',
  }),
  open: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(16)).annotate({
      description:
        "Absolute file or folder paths, or http(s) URLs, to open in the app (macOS only).",
    }),
  ),
});
type OpenAppInput = typeof OpenAppInput.Type;

interface OpenTarget {
  readonly kind: "path" | "url";
  readonly value: string;
  // Lower-case text a window title shows for this target: a file or folder name.
  readonly titleHints: ReadonlyArray<string>;
}

interface ResolvedApp extends AppIdentity {
  readonly running: boolean;
  readonly pid: number | null;
}

const POLL_MS = 250;
const WINDOW_WAIT_MS = 5_000;

// Only web pages and existing local paths are handed to the app; any other scheme (x-apple…,
// javascript:, tel:, a custom app handler) is refused so a launch never fires a URL handler.
const openTarget = (raw: string) =>
  Effect.gen(function* () {
    const url = URL.canParse(raw) && !Path.isAbsolute(raw) ? new URL(raw) : null;
    if (url && (url.protocol === "http:" || url.protocol === "https:")) {
      return { kind: "url", value: url.href, titleHints: [] } satisfies OpenTarget;
    }
    const path = url?.protocol === "file:" ? fileURLToPath(url) : url ? null : raw;
    if (path === null || !Path.isAbsolute(path)) {
      return yield* refuse(
        "unsupported_target",
        `${JSON.stringify(raw)} is not an absolute file or folder path or an http(s) URL; other URL schemes are never opened.`,
      );
    }
    const exists = yield* Effect.tryPromise(() => FS.stat(path)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!exists) return yield* refuse("target_not_found", `${path} does not exist.`);
    const base = Path.basename(path).toLowerCase();
    const stem = Path.parse(base).name;
    return {
      kind: "path",
      value: Path.resolve(path),
      titleHints: stem && stem !== base ? [base, stem] : [base],
    } satisfies OpenTarget;
  });

// A path target shows up as a window titled with its name; a URL only as a window that was not
// there before.
const targetWindow = (
  target: OpenTarget,
  windows: ReadonlyArray<CuaWindow>,
  before: ReadonlySet<number>,
) =>
  windows.find((window) =>
    target.kind === "url"
      ? !before.has(window.window_id)
      : target.titleHints.some((hint) => window.title.toLowerCase().includes(hint)),
  ) ?? null;

export const makeOpenAppTool = (services: ComputerToolServices): ToolEntry => {
  // The installed or running app the input names, as Cua's list_apps knows it.
  const resolveApp = (context: ToolContext, query: string) =>
    Effect.gen(function* () {
      const listed = yield* callCua(services, context, "list_apps", {});
      const app = Schema.decodeUnknownOption(CuaListApps)(listed.structuredContent).pipe(
        Option.map((value) => matchApps(value.apps, query)[0]),
        Option.getOrUndefined,
      );
      if (!app) {
        return yield* refuse(
          "app_not_found",
          `No installed app is named ${JSON.stringify(query)} or has that bundle id. Use the app's name as Finder shows it, or its bundle id.`,
        );
      }
      return {
        name: app.name,
        bundleId: app.bundle_id ?? null,
        launchPath: app.launch_path ?? null,
        running: app.running,
        pid: app.running ? app.pid : null,
      } satisfies ResolvedApp;
    });

  // Cua's macOS launch_app takes a bundle id or name; Windows and Linux prefer the launch path
  // list_apps returned.
  const launchArgs = (app: ResolvedApp, targets: ReadonlyArray<OpenTarget>) => ({
    ...(process.platform === "darwin"
      ? app.bundleId
        ? { bundle_id: app.bundleId }
        : { name: app.name }
      : app.launchPath
        ? { launch_path: app.launchPath }
        : { name: app.name }),
    ...(targets.length > 0 ? { urls: targets.map((target) => target.value) } : {}),
  });

  // Polls the app's windows until every target has one (or, with no targets, any window shows).
  const awaitWindows = (
    context: ToolContext,
    pid: number,
    targets: ReadonlyArray<OpenTarget>,
    before: ReadonlySet<number>,
  ) =>
    Effect.gen(function* () {
      const settled = (windows: ReadonlyArray<CuaWindow>) =>
        targets.length > 0
          ? targets.every((target) => targetWindow(target, windows, before))
          : windows.length > 0;
      const deadline = Date.now() + WINDOW_WAIT_MS;
      let windows = yield* appWindows(services, context, pid);
      while (!settled(windows) && Date.now() < deadline) {
        yield* Effect.sleep(POLL_MS);
        windows = yield* appWindows(services, context, pid);
      }
      return windows;
    });

  return computerTool(services, {
    name: "computer_open_app",
    title: "Open an app",
    description:
      "Launch an app in the background (or reuse it if running) and optionally open files, folders or http(s) URLs in it (macOS only). Returns its pid and windows. Needs act access; browsers take no targets.",
    input: OpenAppInput,
    readOnly: false,
    run: (input: OpenAppInput, context) =>
      Effect.gen(function* () {
        const app = yield* resolveApp(context, input.app);
        const requested = input.open ?? [];
        const refused = launchRefusal(app, requested.length > 0);
        if (refused) return yield* refuse(refused.code, refused.message);
        if (requested.length > 0 && process.platform !== "darwin") {
          return yield* refuse(
            "unsupported_platform",
            "Opening files or URLs in an app works on macOS only; here Cua hands them to the system's default handler instead. Call again without open and use the app's own UI.",
          );
        }
        const grant = yield* services.access.grantFor({
          threadId: callerThread(context),
          turnId: context.callerTurnId,
          app: app.name,
          windowId: null,
          scope: "act",
        });
        if (!grant) {
          return yield* refuse(
            "access_required",
            `This thread has no act access to ${app.name}. Call computer_request_access with app "${app.name}" and scope "act", then retry.`,
          );
        }
        const targets = yield* Effect.forEach(requested, openTarget);
        // A URL's window is told apart from the ones a running app already had.
        const before = new Set(
          app.pid !== null && targets.some((target) => target.kind === "url")
            ? (yield* appWindows(services, context, app.pid)).map((window) => window.window_id)
            : [],
        );

        const launched = yield* callCua(services, context, "launch_app", launchArgs(app, targets));
        const result = Schema.decodeUnknownOption(CuaLaunchedApp)(launched.structuredContent);
        if (Option.isNone(result)) {
          return yield* refuse("computer_protocol", "Cua's launch_app returned no pid.");
        }
        const { pid } = result.value;
        services.access.apps.set(pid, app.name, {
          name: app.name,
          bundleId: app.bundleId,
          launchPath: app.launchPath,
        });
        const windows = yield* awaitWindows(context, pid, targets, before);

        const opened = targets.map((target) => ({
          target,
          window: targetWindow(target, windows, before),
        }));
        const primary =
          opened.find((entry) => entry.window)?.window ??
          windows.find((window) => window.is_on_screen && window.title !== "") ??
          windows[0];
        const lines = [
          `${app.running ? "Reused running" : "Launched"} ${app.name}, pid ${pid}, ${windows.length} ${windows.length === 1 ? "window" : "windows"}.`,
          ...opened.map(({ target, window }) =>
            window
              ? `Opened ${target.value} in window ${window.window_id}.`
              : `No window for ${target.value} appeared within ${WINDOW_WAIT_MS / 1000} s; the app may still be loading it or show an error. Read its windows before retrying.`,
          ),
          ...(windows.length > 0
            ? [
                untrustedContent(
                  "APP_CONTENT",
                  `app=${JSON.stringify(app.name)} source=computer_open_app`,
                  windows.map(windowSummary).join("\n"),
                ),
              ]
            : []),
          ...(primary ? [windowLine(primary)] : []),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }),
  });
};
