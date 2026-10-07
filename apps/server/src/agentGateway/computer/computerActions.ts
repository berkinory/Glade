import { Effect, Option, Schema } from "effect";

import { MAX_UNOBSERVED_REPEATS } from "../../computer/computerProgressGuard.ts";
import {
  CuaActionOutcome,
  resultText,
  type CuaToolResult,
  type CuaWindow,
} from "../../computer/cuaResults.ts";
import type { SnapshotDiff } from "../../computer/windowSnapshots.ts";
import type { McpToolCallResult } from "../protocol.ts";
import type { ToolContext } from "../toolRuntime.ts";
import {
  appContent,
  callCua,
  callerThread,
  recordSnapshot,
  refuse,
  SCREENSHOT_MAX_EDGE,
  windowFor,
  type ComputerToolServices,
  type WindowInput,
  type WindowNeed,
} from "./computerCalls.ts";
import { renderDiff } from "./elementText.ts";

export interface CuaCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

// Input the user produced within this many whole seconds blocks foreground delivery.
const USER_ACTIVE_SECONDS = 1;
// The OS idle clock counts the agent's own foreground input too; after one, a reading only says
// something about the user once a full idle second has passed.
const OWN_INPUT_SETTLE_MS = 1_100;
// Lets the app apply the action before the window is read again.
const OBSERVE_SETTLE_MS = 150;

// Chords like "cmd+shift+s" go to Cua's hotkey; single keys to press_key.
export const keyCall = (key: string) => {
  const parts = key.split("+").map((part) => part.trim().toLowerCase());
  return parts.length > 1
    ? { tool: "hotkey", args: { keys: parts } }
    : { tool: "press_key", args: { key: parts[0] } };
};

// Foreground delivery moves the real pointer and keyboard, so it waits for the user to pause
// rather than fight them. Background delivery never reaches this check.
const yieldToUser = (services: ComputerToolServices) =>
  Effect.gen(function* () {
    const sinceOwnInput = Date.now() - services.access.tasks.lastRealInputAt();
    if (sinceOwnInput < OWN_INPUT_SETTLE_MS) {
      yield* Effect.sleep(OWN_INPUT_SETTLE_MS - sinceOwnInput);
    }
    const idle = yield* services.host.userIdleSeconds.pipe(
      Effect.catch((error) => refuse("computer_protocol", error.message)),
    );
    if (idle !== null && idle < USER_ACTIVE_SECONDS) {
      return yield* refuse(
        "user_active",
        "The user is using the mouse or keyboard right now, so foreground input was not sent. Wait a few seconds and retry, or stay with background delivery.",
      );
    }
  });

type Observation =
  | { readonly kind: "none" }
  | { readonly kind: "diff"; readonly diff: SnapshotDiff }
  | { readonly kind: "failed"; readonly message: string };

// Re-reads the window's tree after an action when the agent has read it before, so the result
// can say what changed and the agent's element indexes stay current.
const observe = (services: ComputerToolServices, context: ToolContext, input: WindowInput) =>
  services.access.snapshots.has(callerThread(context), {
    pid: input.pid,
    windowId: input.window_id,
  })
    ? Effect.sleep(OBSERVE_SETTLE_MS).pipe(
        Effect.andThen(
          // A tree-only read would replace the screenshot Cua maps pixel coordinates through,
          // and the next pixel action would be refused; this read keeps one at the same size.
          callCua(services, context, "get_window_state", {
            pid: input.pid,
            window_id: input.window_id,
            max_image_dimension: SCREENSHOT_MAX_EDGE,
          }),
        ),
        Effect.map((result): Observation => {
          const { diff } = recordSnapshot(services, context, input, result, false);
          return diff ? { kind: "diff", diff } : { kind: "none" };
        }),
        Effect.catch((error) =>
          Effect.succeed<Observation>({ kind: "failed", message: error.message }),
        ),
      )
    : Effect.succeed<Observation>({ kind: "none" });

const hasChanges = (diff: SnapshotDiff) =>
  diff.added.length + diff.changed.length + diff.removed.length > 0;

// Action results carry Cua's effect classification, what changed in the window and any
// escalation. The closing `Window:` line names the target for the model and the chat timeline.
function actionContent(
  result: CuaToolResult,
  window: CuaWindow,
  outcome: Option.Option<CuaActionOutcome>,
  observation: Observation,
): McpToolCallResult {
  const lines = [resultText(result) || "Done."];
  const appLines: string[] = [];
  if (Option.isSome(outcome)) {
    lines.push(`Effect: ${outcome.value.effect}.`);
    for (const evidence of outcome.value.evidence ?? []) {
      if (evidence.detail) appLines.push(`${evidence.kind}: ${evidence.detail}`);
    }
  }
  if (observation.kind === "diff") {
    const rendered = renderDiff(observation.diff);
    if (rendered) {
      lines.push("Changes in the window (+ new, ~ changed, - gone; indexes stay valid):");
      appLines.push(rendered);
    } else {
      lines.push(
        observation.diff.comparable
          ? "No change in the window's accessibility tree."
          : "No change among the elements of your last (filtered) read of this window.",
      );
    }
  } else if (observation.kind === "failed") {
    lines.push(`Could not read the window again: ${observation.message}`);
  }
  if (appLines.length > 0) lines.push(appContent(window, appLines.join("\n")));
  const escalation = Option.isSome(outcome) ? outcome.value.escalation : null;
  if (escalation) {
    lines.push(
      `Escalation: ${escalation.target} (${escalation.reason}).${
        escalation.target === "foreground"
          ? " Retry with delivery: foreground, which needs full control."
          : escalation.target === "pixel"
            ? " Take a computer_screenshot and use the pixel tools."
            : ""
      }`,
    );
  }
  lines.push(`Window: ${window.app_name} ${JSON.stringify(window.title)}`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(Option.isSome(outcome) && outcome.value.effect === "refused" ? { isError: true } : {}),
  };
}

// One input action on an authorized window: refuse fruitless repeats, yield to the user before
// foreground input, run the Cua tool, then report what it changed. `input` is the tool's own
// input; identical inputs are the same action for the progress guard.
export const performAction = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  window: CuaWindow,
  call: CuaCall,
) =>
  Effect.gen(function* () {
    const threadId = callerThread(context);
    const actionKey = JSON.stringify([call.tool, input]);
    if (services.access.progress.blocked(threadId, actionKey)) {
      return yield* refuse(
        "no_progress",
        `This exact ${call.tool} already ran ${MAX_UNOBSERVED_REPEATS} times in a row without any observed effect, so it was not sent again. Read the window (computer_window_state or computer_screenshot) and change approach.`,
      );
    }
    const foreground = call.args.delivery_mode === "foreground";
    if (foreground) yield* yieldToUser(services);
    const result = yield* callCua(services, context, call.tool, call.args).pipe(
      Effect.ensuring(
        foreground ? Effect.sync(() => services.access.tasks.markRealInput()) : Effect.void,
      ),
    );
    const outcome = Schema.decodeUnknownOption(CuaActionOutcome)(result.structuredContent);
    const observation = yield* observe(services, context, input);
    const confirmed =
      Option.isSome(outcome) &&
      (outcome.value.effect === "confirmed" || outcome.value.effect === "partial");
    services.access.progress.recordAction(
      threadId,
      actionKey,
      confirmed || (observation.kind === "diff" && hasChanges(observation.diff)),
    );
    return actionContent(result, window, outcome, observation);
  });

export const windowAction = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  need: WindowNeed,
  call: CuaCall,
) =>
  windowFor(services, context, input, need).pipe(
    Effect.flatMap((window) => performAction(services, context, input, window, call)),
  );
