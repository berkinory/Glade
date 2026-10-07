import { Effect } from "effect";

import { resultText, type CuaElement, type CuaToolResult } from "../../computer/cuaResults.ts";
import type { ToolContext } from "../toolRuntime.ts";
import {
  callCuaResult,
  refuse,
  refuseCuaError,
  windowFor,
  type ComputerToolServices,
  type WindowInput,
} from "./computerCalls.ts";
import { yieldToUser } from "./computerActions.ts";
import { ellipsisVariant, matchMenuTitle, menuSegments, menuTitles } from "./menuPath.ts";
import { readWindow } from "./windowRead.ts";

const MISSING_SEGMENT = /path segment (\d+) was not found/;

const missingSegment = (result: CuaToolResult) => {
  if (!result.isError) return null;
  const match = MISSING_SEGMENT.exec(resultText(result));
  return match ? Number(match[1]) : null;
};

const withNote = (result: CuaToolResult, note: string): CuaToolResult => ({
  ...result,
  content: [{ type: "text", text: note }, ...result.content],
});

const MENU_OPEN_WAIT_MS = 1_500;
const MENU_OPEN_POLL_MS = 250;

// The items of the menu opened under `parent`. A submenu opens beside its parent menu, which stays
// open; its items are the open ones that are not siblings of the parent segment.
const openMenuItems = (elements: ReadonlyArray<CuaElement>, parent: string) => {
  const open = elements.filter(
    (element) =>
      element.role === "MenuItem" &&
      element.label &&
      elements.some((menu) => menu.role === "Menu" && menu.element_index === element.parent_index),
  );
  const title = matchMenuTitle(
    parent,
    open.map((item) => item.label!),
  );
  const parentMenu = open.find((item) => item.label === title)?.parent_index;
  return open.filter((item) => title === null || item.parent_index !== parentMenu);
};

// WinUI fills an opened menu a moment after Cua's expand returns.
const awaitOpenMenu = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  parent: string,
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + MENU_OPEN_WAIT_MS;
    for (;;) {
      const read = yield* readWindow(services, context, input, { screenshot: "context" });
      const items = openMenuItems(
        read.elements.map((entry) => entry.element),
        parent,
      );
      if (items.length > 0 || Date.now() >= deadline) return items;
      yield* Effect.sleep(MENU_OPEN_POLL_MS);
    }
  });

// Windows 11 menu bars (WinUI) open a menu's items in a popup that the window's tree lists as a
// parentless "Menu", not under the menu bar item. Cua 0.34's invoke_menu expands the item and then
// reports the next segment missing, leaving the menu open; the rest of the path is pressed there.
const pressInOpenMenu = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  requested: ReadonlyArray<string>,
  first: number,
) =>
  Effect.gen(function* () {
    const ran = requested.slice(0, first);
    let result: CuaToolResult | null = null;
    for (let index = first; index < requested.length; index++) {
      let items = yield* awaitOpenMenu(services, context, input, ran[index - 1]!);
      // A WinUI menu is a light-dismiss flyout: it opens only for the foreground window. Bringing
      // the window forward takes the user's focus, so it needs full control and a pause.
      if (items.length === 0 && index === first) {
        yield* windowFor(services, context, input, { scope: "full", action: "input" }).pipe(
          Effect.catch(() =>
            refuse(
              "access_required",
              `Windows opens this app's menus only while its window is in front, and bringing it forward needs full control. Call computer_request_access with scope "full" and retry, or ask the user to bring the window to the front.`,
            ),
          ),
        );
        yield* yieldToUser(services);
        yield* callCuaResult(services, context, "bring_to_front", {
          pid: input.pid,
          window_id: input.window_id,
        });
        yield* callCuaResult(services, context, "invoke_menu", {
          pid: input.pid,
          window_id: input.window_id,
          path: ran,
        });
        items = yield* awaitOpenMenu(services, context, input, ran[index - 1]!);
      }
      const titles = items.map((item) => item.label!);
      const title = matchMenuTitle(requested[index]!, titles);
      const item = items.find((entry) => entry.label === title);
      if (!item) {
        const above = ran.join(" ▸ ");
        return yield* refuse(
          "menu_item_not_found",
          `No menu item "${requested[index]}" under "${above}", which is still open.${titles.length > 0 ? ` Available: ${titles.join(", ")}.` : ""}`,
          { segment: index, requested: requested[index], available: titles },
        );
      }
      result = yield* callCuaResult(services, context, "click", {
        pid: input.pid,
        window_id: input.window_id,
        element_token: item.element_token,
      });
      if (result.isError) return yield* refuseCuaError("click", result);
      ran.push(item.label!);
    }
    if (!result) return yield* refuse("invalid_input", "menu_path has no item below the menu bar.");
    return withNote(result, `Ran menu ${ran.join(" ▸ ")}.`);
  });

// Runs a menu bar item through Cua's exact-path invoke_menu, forgiving the ways models misspell
// a path: case, a missing or extra ellipsis, shortcut suffixes, arrows in one string. A segment
// Cua cannot find is resolved against the titles the window's tree lists at that level; when
// none matches, the refusal carries those titles so the next call can name one.
export const invokeMenu = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  path: string | ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const requested = menuSegments(path);
    if (requested.length === 0) return yield* refuse("invalid_input", "menu_path is empty.");
    const attempt = (labels: ReadonlyArray<string>) =>
      callCuaResult(services, context, "invoke_menu", {
        pid: input.pid,
        window_id: input.window_id,
        path: labels,
      });
    let labels = [...requested];
    let result = yield* attempt(labels);
    const flipped = new Set<number>();
    const looked = new Set<number>();
    for (let index = missingSegment(result); index !== null; index = missingSegment(result)) {
      if (process.platform === "win32" && index > 0) {
        return yield* pressInOpenMenu(services, context, input, labels, index);
      }
      const segment = labels[index]!;
      let next = flipped.has(index) ? null : ellipsisVariant(segment);
      flipped.add(index);
      if (next === null) {
        if (looked.has(index)) break;
        looked.add(index);
        // Linux and Windows list the menu bar's menus deeper than macOS (under the window's
        // panes), and only that level, so there the whole tree is read.
        const read = yield* readWindow(services, context, input, {
          ...(process.platform === "darwin" ? { maxDepth: 2 * index + 2 } : {}),
          screenshot: "context",
        });
        const above = labels.slice(0, index);
        const titles = menuTitles(
          read.elements.map((entry) => entry.element),
          above,
        );
        next = titles ? matchMenuTitle(requested[index]!, titles) : null;
        if (next === null) {
          const where = index === 0 ? "in the menu bar" : `under "${above.join(" ▸ ")}"`;
          return yield* refuse(
            "menu_item_not_found",
            `No menu item "${requested[index]}" ${where}.${titles ? ` Available: ${titles.join(", ")}.` : ""} Items an app adds only while a menu is open can be missing from this list.`,
            { segment: index, requested: requested[index], available: titles ?? [] },
          );
        }
      }
      if (next === segment) break;
      labels = labels.map((label, position) => (position === index ? next : label));
      result = yield* attempt(labels);
    }
    if (result.isError) return yield* refuseCuaError("invoke_menu", result);
    const ran = labels.join(" ▸ ");
    return ran === requested.join(" ▸ ") ? result : withNote(result, `Ran menu ${ran}.`);
  });
