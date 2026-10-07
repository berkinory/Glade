import { Effect, Option, Schema } from "effect";
import * as FS from "node:fs/promises";

import { CuaListWindows, type CuaWindow } from "../../computer/cuaResults.ts";
import type { IndexedElement } from "../../computer/windowSnapshots.ts";
import type { ToolContext, ToolEntry } from "../toolRuntime.ts";
import { yieldToUser } from "./computerActions.ts";
import {
  appContent,
  callCua,
  callCuaResult,
  callerThread,
  computerTool,
  refuse,
  windowFor,
  windowLine,
  type ComputerToolServices,
  type WindowInput,
} from "./computerCalls.ts";
import { dialogTarget, formatItem, panelControls, type PanelControls } from "./fileDialog.logic.ts";
import { invokeMenu } from "./menuInvoke.ts";
import { readWindow, SHEET_READ_DEPTH } from "./windowRead.ts";

const FileDialogInput = Schema.Struct({
  pid: Schema.Int.annotate({ description: "Process id from computer_apps." }),
  window_id: Schema.Int.annotate({
    description: "The document window (its Save sheet attaches to it) or the app's Open window.",
  }),
  action: Schema.Literals(["save", "open"]),
  path: Schema.String.annotate({
    description:
      "Absolute folder to save into, or the file to open (or its folder, with file_name). ~/ is the home folder.",
  }),
  file_name: Schema.optional(
    Schema.String.annotate({
      description:
        "save: the name to save as (its extension picks the format when it can); open: the file in path.",
    }),
  ),
  overwrite: Schema.optional(
    Schema.Boolean.annotate({ description: "save: replace an existing file. Default false." }),
  ),
});
type FileDialogInput = typeof FileDialogInput.Type;

const POLL_MS = 250;
const SHEET_WAIT_MS = 4_000;
const STEP_WAIT_MS = 2_500;

const MENUS = {
  save: [
    ["File", "Save As…"],
    ["File", "Save…"],
  ],
  open: [["File", "Open…"]],
} as const;

export const makeFileDialogTool = (services: ComputerToolServices): ToolEntry => {
  // A standalone Open window closes once a file is chosen; reading it then reports it gone.
  const read = (context: ToolContext, host: WindowInput) =>
    readWindow(services, context, host, { maxDepth: SHEET_READ_DEPTH, screenshot: "none" }).pipe(
      Effect.map((result) => ({
        elements: result.elements,
        panel: panelControls(result.elements),
      })),
      Effect.catchIf(
        (error) => error.code === "window_id_not_found",
        () => Effect.succeed({ elements: [] as ReadonlyArray<IndexedElement>, panel: null }),
      ),
    );

  // Reads until `done` holds or the wait runs out; the last read either way.
  const waitFor = (
    context: ToolContext,
    host: WindowInput,
    done: (panel: PanelControls | null) => boolean,
    waitMs: number,
  ) =>
    Effect.gen(function* () {
      const deadline = Date.now() + waitMs;
      let last = yield* read(context, host);
      while (!done(last.panel) && Date.now() < deadline) {
        yield* Effect.sleep(POLL_MS);
        last = yield* read(context, host);
      }
      return last;
    });

  const token = (context: ToolContext, host: WindowInput, index: number) =>
    services.access.snapshots.token(
      callerThread(context),
      { pid: host.pid, windowId: host.window_id },
      index,
    );

  const press = (context: ToolContext, host: WindowInput, index: number) =>
    // A press that opens a modal prompt can report an AX failure although it worked; the next
    // read says what happened.
    callCuaResult(services, context, "click", {
      pid: host.pid,
      window_id: host.window_id,
      element_token: token(context, host, index),
    });

  // Panels run in the app's out-of-process panel service, which takes no keys Cua aims at a
  // window (Cua 0.34). Keys go to the frontmost app instead, so each one is sent only right
  // after Cua confirmed this app is frontmost, and only after the user paused.
  const frontKey = (context: ToolContext, host: WindowInput, keys: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      yield* yieldToUser(services);
      const front = yield* callCuaResult(services, context, "bring_to_front", {
        pid: host.pid,
        window_id: host.window_id,
      });
      // Cua reports a sheet-holding window as "not verified" (the sheet has focus) yet names the
      // frontmost process, which is all the desktop-scoped key needs.
      const observed = front.structuredContent?.observed as { frontmost_pid?: unknown } | undefined;
      if ((front.isError ? observed?.frontmost_pid : host.pid) !== host.pid) {
        return yield* refuse(
          "user_active",
          "Another app came to the front, so no keys were sent. Retry computer_file_dialog.",
        );
      }
      yield* (
        keys.length > 1
          ? callCua(services, context, "hotkey", { scope: "desktop", keys })
          : callCua(services, context, "press_key", { scope: "desktop", key: keys[0] })
      ).pipe(Effect.ensuring(Effect.sync(() => services.access.tasks.markRealInput())));
    });

  const windowsOf = (context: ToolContext, pid: number) =>
    callCua(services, context, "list_windows", { pid }).pipe(
      Effect.map((result) =>
        Schema.decodeUnknownOption(CuaListWindows)(result.structuredContent).pipe(
          Option.map((value) => value.windows.filter((window) => window.pid === pid)),
          Option.getOrElse((): ReadonlyArray<CuaWindow> => []),
        ),
      ),
    );

  // The window showing the panel: the given one, or a panel the app opens through its File menu
  // (a sheet on the same window, or a new standalone window).
  const openPanel = (context: ToolContext, input: FileDialogInput) =>
    Effect.gen(function* () {
      const given = { pid: input.pid, window_id: input.window_id };
      const first = yield* read(context, given);
      if (first.panel) return given;
      const before = new Set((yield* windowsOf(context, input.pid)).map((w) => w.window_id));
      for (const path of MENUS[input.action]) {
        const ran = yield* invokeMenu(services, context, given, path).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
        if (!ran) continue;
        const deadline = Date.now() + SHEET_WAIT_MS;
        while (Date.now() < deadline) {
          if ((yield* read(context, given)).panel) return given;
          for (const window of yield* windowsOf(context, input.pid)) {
            if (before.has(window.window_id)) continue;
            const host = { pid: input.pid, window_id: window.window_id };
            yield* windowFor(services, context, host, { scope: "full", action: "input" });
            if ((yield* read(context, host)).panel) return host;
          }
          yield* Effect.sleep(POLL_MS);
        }
      }
      return yield* refuse(
        "no_file_dialog",
        `${input.action === "save" ? "File ▸ Save As…/Save…" : "File ▸ Open…"} showed no Open or Save panel in this window. A document that already has a file may save in place; read the window to see what happened.`,
      );
    });

  return computerTool(services, {
    name: "computer_file_dialog",
    title: "Use an Open or Save panel",
    description:
      "Drive the macOS Open or Save panel of a granted app in one call: opens it through the File menu when none is showing, goes to the folder with Go to Folder, sets the file name (and the format when the extension implies one), confirms, and reports the saved or opened file. An existing file is never replaced unless overwrite is true. Sends a few keys to the app while it is frontmost, so it needs full control and waits while the user is typing or clicking.",
    input: FileDialogInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(services, context, input, {
          scope: "full",
          action: "input",
        });
        const target = dialogTarget(input);
        if (typeof target === "string") return yield* refuse("invalid_input", target);
        const host = yield* openPanel(context, input);

        let state = yield* read(context, host);
        if (!state.panel?.goToField) {
          yield* frontKey(context, host, ["cmd", "shift", "g"]);
          state = yield* waitFor(context, host, (panel) => Boolean(panel?.goToField), STEP_WAIT_MS);
        }
        const goTo = state.panel?.goToField;
        if (!goTo) {
          return yield* refuse(
            "file_dialog_keys",
            "Go to Folder did not open in the panel, so its keys did not reach it. Read the window and drive the panel by element index, or ask the user to bring the app forward.",
          );
        }
        yield* callCua(services, context, "set_value", {
          pid: host.pid,
          window_id: host.window_id,
          element_token: token(context, host, goTo.index),
          value: target.goTo,
        });
        yield* frontKey(context, host, ["return"]);
        state = yield* waitFor(context, host, (panel) => !panel?.goToField, STEP_WAIT_MS);
        if (state.panel?.goToField) {
          return yield* refuse(
            "file_dialog_path",
            `Go to Folder did not accept ${target.goTo}; it may not exist. The panel is still open.`,
          );
        }

        const notes: string[] = [];
        if (input.action === "save" && target.name !== null && state.panel?.nameField) {
          yield* callCua(services, context, "set_value", {
            pid: host.pid,
            window_id: host.window_id,
            element_token: token(context, host, state.panel.nameField.index),
            value: target.name,
          });
          const popup = state.panel.formatPopup;
          if (popup) notes.push(...(yield* chooseFormat(context, host, popup.index, target.name)));
          state = yield* read(context, host);
        }
        const confirm = state.panel?.confirm;
        if (!confirm)
          return yield* refuse("file_dialog_state", "The panel has no Save or Open button now.");
        yield* press(context, host, confirm.index);
        state = yield* waitFor(
          context,
          host,
          (panel) => !panel || Boolean(panel.replacePrompt),
          STEP_WAIT_MS,
        );
        const prompt = state.panel?.replacePrompt;
        if (prompt && !input.overwrite) {
          if (prompt.cancel) yield* press(context, host, prompt.cancel.index);
          return yield* refuse(
            "file_exists",
            `${target.file ?? "The file"} already exists, so nothing was replaced and the Save panel is still open. Call again with overwrite: true only if the user wants it replaced.`,
            { prompt: prompt.text },
          );
        }
        if (prompt) {
          yield* press(context, host, prompt.replace.index);
          state = yield* waitFor(context, host, (panel) => !panel, STEP_WAIT_MS);
        }
        if (state.panel) {
          return yield* refuse(
            "file_dialog_state",
            "The panel is still open after confirming. Read the window to see why.",
          );
        }
        return yield* report(context, input, window, target.file, notes);
      }),
  });

  // Picks the format matching the file name's extension from the panel's format pop-up, if any
  // item fits; otherwise the format stays and the result says so.
  function chooseFormat(context: ToolContext, host: WindowInput, popup: number, name: string) {
    return Effect.gen(function* () {
      yield* press(context, host, popup);
      const { elements } = yield* read(context, host);
      const popupCua = elements.find((entry) => entry.index === popup)?.element.element_index;
      const menus = new Set(
        elements
          .filter(
            (entry) => entry.element.role === "AXMenu" && entry.element.parent_index === popupCua,
          )
          .map((entry) => entry.element.element_index),
      );
      const items = elements.filter(
        (entry) =>
          entry.element.role === "AXMenuItem" &&
          entry.element.parent_index !== undefined &&
          entry.element.parent_index !== null &&
          menus.has(entry.element.parent_index),
      );
      const item = formatItem(
        items.map((entry) => entry.element.label ?? ""),
        name,
      );
      const chosen = items.find((entry) => entry.element.label === item);
      if (chosen) {
        yield* press(context, host, chosen.index);
        return [`Format: ${item}.`];
      }
      yield* callCuaResult(services, context, "click", {
        pid: host.pid,
        window_id: host.window_id,
        element_token: token(context, host, popup),
        action: "cancel",
      });
      return [`Format unchanged: no format in the panel matches ${name}.`];
    });
  }

  function report(
    context: ToolContext,
    input: FileDialogInput,
    window: CuaWindow,
    file: string | null,
    notes: ReadonlyArray<string>,
  ) {
    return Effect.gen(function* () {
      // Only the file this call named is checked, so the tool never answers whether other paths
      // exist.
      const size = file
        ? yield* Effect.tryPromise(() => FS.stat(file)).pipe(
            Effect.map((stat) => (stat.isFile() ? stat.size : null)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;
      const windows = yield* windowsOf(context, input.pid);
      const now = windows.find((entry) => entry.window_id === window.window_id) ?? window;
      const verb = input.action === "save" ? "Saved" : "Opened";
      const fileLine =
        file === null
          ? `${verb} with the panel's suggested name.`
          : size !== null
            ? `${verb} ${file} (${size} bytes on disk).`
            : `${verb} ${file}, but the file is not on disk yet; check the window title.`;
      const titles = windows
        .filter((entry) => entry.is_on_screen && entry.title !== "")
        .map((entry) => `window ${entry.window_id} ${JSON.stringify(entry.title)}`);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              fileLine,
              ...notes,
              appContent(now, `Windows now: ${titles.join(", ")}`),
              windowLine(now),
            ].join("\n"),
          },
        ],
      };
    });
  }
};
