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
import type { GatewayToolError } from "../toolRuntime.ts";
import {
  appContent,
  callCua,
  callerThread,
  refuse,
  windowLine,
  type ComputerToolServices,
  type WindowInput,
} from "./computerCalls.ts";
import { renderDiff } from "./elementText.ts";
import { readWindow } from "./windowRead.ts";

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
const LATE_CHANGE_MS = 450;

// Foreground delivery moves the real pointer and keyboard, so it waits for the user to pause
// rather than fight them. Background delivery never reaches this check.
export const yieldToUser = (services: ComputerToolServices) =>
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

const hasChanges = (diff: SnapshotDiff) =>
  diff.added.length +
    diff.changed.length +
    diff.removed.length +
    diff.sheetsOpened.length +
    diff.sheetsClosed.length >
  0;

// Re-reads the window's tree after an action when the agent has read it before, so the result
// can say what changed and the agent's element indexes stay current. Sheets and dialogs animate
// in after the first re-read, so a read that shows nothing yet is repeated once.
const observe = (services: ComputerToolServices, context: ToolContext, input: WindowInput) => {
  const reread = Effect.sleep(OBSERVE_SETTLE_MS).pipe(
    Effect.andThen(readWindow(services, context, input, { screenshot: "context" })),
  );
  return services.access.snapshots.has(callerThread(context), {
    pid: input.pid,
    windowId: input.window_id,
  })
    ? reread.pipe(
        Effect.flatMap(({ diff }) =>
          diff && !hasChanges(diff)
            ? Effect.sleep(LATE_CHANGE_MS).pipe(Effect.andThen(reread))
            : Effect.succeed({ diff }),
        ),
        Effect.map(({ diff }): Observation => (diff ? { kind: "diff", diff } : { kind: "none" })),
        Effect.catch((error) =>
          Effect.succeed<Observation>({ kind: "failed", message: error.message }),
        ),
      )
    : Effect.succeed<Observation>({ kind: "none" });
};

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
    for (const sheet of observation.diff.sheetsOpened) {
      lines.push(
        `Sheet opened: [${sheet.index}] ${JSON.stringify(sheet.element.label ?? "")}; its controls are in this window's tree. For an Open or Save panel use computer_file_dialog.`,
      );
    }
    for (const sheet of observation.diff.sheetsClosed) {
      lines.push(`Sheet closed: [${sheet.index}] ${JSON.stringify(sheet.element.label ?? "")}.`);
    }
    const rendered = renderDiff(observation.diff);
    if (rendered) {
      lines.push("Changes in the window (indexes stay valid):");
      appLines.push(rendered);
    } else if (observation.diff.sheetsOpened.length + observation.diff.sheetsClosed.length === 0) {
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
            ? " Take a computer_screenshot and act by coordinate."
            : ""
      }`,
    );
  }
  lines.push(windowLine(window));
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(Option.isSome(outcome) && outcome.value.effect === "refused" ? { isError: true } : {}),
  };
}

// One input action on an authorized window: refuse fruitless repeats, yield to the user before
// foreground input, run the Cua tool (or `run`, which performs the call its own way), then report
// what it changed. `input` is the tool's own input; identical inputs are the same action for the
// progress guard. An effect Cua confirmed by reading the element back needs no re-read.
export const performAction = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  window: CuaWindow,
  call: CuaCall,
  run: Effect.Effect<CuaToolResult, GatewayToolError> = callCua(
    services,
    context,
    call.tool,
    call.args,
  ),
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
    const result = yield* run.pipe(
      Effect.ensuring(
        foreground ? Effect.sync(() => services.access.tasks.markRealInput()) : Effect.void,
      ),
    );
    const outcome = Schema.decodeUnknownOption(CuaActionOutcome)(result.structuredContent);
    const effect = Option.isSome(outcome) ? outcome.value.effect : null;
    const observation =
      effect === "confirmed"
        ? ({ kind: "none" } as const)
        : yield* observe(services, context, input);
    const confirmed = effect === "confirmed" || effect === "partial";
    services.access.progress.recordAction(
      threadId,
      actionKey,
      confirmed || (observation.kind === "diff" && hasChanges(observation.diff)),
    );
    return actionContent(result, window, outcome, observation);
  });
