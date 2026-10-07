import { Effect } from "effect";

import { resultText, type CuaToolResult } from "../../computer/cuaResults.ts";
import type { ToolContext } from "../toolRuntime.ts";
import {
  callCuaResult,
  refuse,
  refuseCuaError,
  type ComputerToolServices,
  type WindowInput,
} from "./computerCalls.ts";
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
      const segment = labels[index]!;
      let next = flipped.has(index) ? null : ellipsisVariant(segment);
      flipped.add(index);
      if (next === null) {
        if (looked.has(index)) break;
        looked.add(index);
        const read = yield* readWindow(services, context, input, {
          maxDepth: 2 * index + 2,
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
