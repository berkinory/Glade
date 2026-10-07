import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { Effect, Option, Schema } from "effect";

import { MAX_IMAGES_PER_TURN } from "../../computer/computerTask.ts";
import {
  CuaActionOutcome,
  CuaFailure,
  CuaListWindows,
  resultImage,
  resultText,
  type CuaToolResult,
  type CuaWindow,
} from "../../computer/cuaResults.ts";
import type { ComputerAccessShape } from "../../computer/Services/ComputerAccess.ts";
import { ComputerHostError, type ComputerHostShape } from "../../computer/Services/ComputerHost.ts";
import type { ThreadComputerUseShape } from "../../orchestration/Services/ThreadComputerUse.ts";
import { toolInputSchema, type McpToolCallResult } from "../protocol.ts";
import {
  GatewayToolError,
  gatewayToolErrorResult,
  type ToolContext,
  type ToolEntry,
} from "../toolRuntime.ts";

export interface ComputerToolServices {
  readonly host: ComputerHostShape;
  readonly access: ComputerAccessShape;
  readonly computerUse: ThreadComputerUseShape;
}

type Content = McpToolCallResult["content"][number];

const CALL_TIMEOUT_MS = 30_000;
// Long edge of screenshots handed to the model. Cua scales its own coordinate space to the image
// it returns, so pixel actions use the model's coordinates unchanged.
export const SCREENSHOT_MAX_EDGE = 1280;

const refusal = (code: string, message: string) => new GatewayToolError(code, message);
export const refuse = (code: string, message: string) => Effect.fail(refusal(code, message));

// Thread ownership comes from the gateway session (context.callerThreadId), never tool input.
export const callerThread = (context: ToolContext) => ThreadId.makeUnsafe(context.callerThreadId);

const isComputerUseOn = (services: ComputerToolServices, threadId: string) =>
  services.computerUse.mode(ThreadId.makeUnsafe(threadId)) !== "off";

// One Cua tools/call in the caller thread's own Cua session. Stop aborts it, which cancels it in
// Cua; a Cua tool error becomes a typed refusal carrying Cua's code and text.
export const callCua = (
  services: ComputerToolServices,
  context: ToolContext,
  name: string,
  args: Readonly<Record<string, unknown>>,
  timeoutMs = CALL_TIMEOUT_MS,
) =>
  Effect.gen(function* () {
    const threadId = callerThread(context);
    const call = services.access.tasks.begin(threadId, context.callerTurnId);
    const stopped = Effect.callback<never, ComputerHostError>((resume) => {
      const onAbort = () =>
        resume(
          Effect.fail(
            new ComputerHostError({ code: "cancelled", message: "Stopped by the user." }),
          ),
        );
      if (call.signal.aborted) onAbort();
      else call.signal.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(() => call.signal.removeEventListener("abort", onAbort));
    });
    const result = yield* Effect.raceFirst(
      services.host.callTool(name, args, { timeoutMs, threadId }),
      stopped,
    ).pipe(
      Effect.ensuring(Effect.sync(call.end)),
      Effect.mapError((error) =>
        refusal(
          error.code === "cancelled" ? "stopped" : `computer_${error.code}`,
          error.code === "cancelled"
            ? "The user stopped Computer Use for this turn. Do not continue."
            : error.message,
        ),
      ),
    );
    if (result.isError) {
      const code = Schema.decodeUnknownOption(CuaFailure)(result.structuredContent).pipe(
        Option.map((failure) => failure.code),
        Option.getOrElse(() => "cua_error"),
      );
      return yield* refuse(code, resultText(result) || `${name} failed.`);
    }
    return result;
  });

const requireComputerUse = (services: ComputerToolServices, context: ToolContext) =>
  isComputerUseOn(services, context.callerThreadId)
    ? Effect.void
    : refuse(
        "computer_use_off",
        "Computer Use is off for this thread. Ask the user to turn it on with /computer or the thread menu.",
      );

// The window as Cua lists it now: the grant check needs its app, and a pid/window pair that does
// not match is refused before anything acts on it.
const resolveWindow = (
  services: ComputerToolServices,
  context: ToolContext,
  pid: number,
  windowId: number,
) =>
  Effect.gen(function* () {
    const listed = yield* callCua(services, context, "list_windows", { pid });
    const windows = Schema.decodeUnknownOption(CuaListWindows)(listed.structuredContent).pipe(
      Option.map((value) => value.windows),
      Option.getOrElse((): ReadonlyArray<CuaWindow> => []),
    );
    // Cua can list other processes' windows too. Later calls pass the agent's pid to Cua, so the
    // granted window must belong to that pid.
    const window = windows.find((entry) => entry.window_id === windowId && entry.pid === pid);
    if (!window) {
      return yield* refuse(
        "window_not_found",
        `pid ${pid} has no window ${windowId}. Call computer_apps for current pids and window ids.`,
      );
    }
    return window;
  });

const SCOPE_NEEDS: Record<ComputerAccessScope, string> = {
  read: "read access",
  act: "act access",
  full: "full control",
};

// The grant gate every window-scoped tool passes before Cua sees the call.
const authorize = (
  services: ComputerToolServices,
  context: ToolContext,
  window: CuaWindow,
  scope: ComputerAccessScope,
) =>
  Effect.gen(function* () {
    const grant = services.access.grants.check(
      callerThread(context),
      { app: window.app_name, windowId: window.window_id },
      scope,
    );
    if (!grant) {
      return yield* refuse(
        "access_required",
        `This thread has no ${SCOPE_NEEDS[scope]} to ${window.app_name}. Call computer_request_access with app "${window.app_name}" and scope "${scope}", then retry.`,
      );
    }
  });

export const windowFor = (
  services: ComputerToolServices,
  context: ToolContext,
  input: { readonly pid: number; readonly window_id: number },
  scope: ComputerAccessScope,
) =>
  resolveWindow(services, context, input.pid, input.window_id).pipe(
    Effect.tap((window) => authorize(services, context, window, scope)),
  );

// Screenshots leave the server as JPEG at Cua's pixel size, within the turn's image budget.
export const imageContent = (
  services: ComputerToolServices,
  context: ToolContext,
  result: CuaToolResult,
) =>
  Effect.gen(function* () {
    const image = resultImage(result);
    if (!image) return [] as Content[];
    if (!services.access.tasks.takeImage(callerThread(context), context.callerTurnId)) {
      return yield* refuse(
        "image_budget_exhausted",
        `This turn already returned ${MAX_IMAGES_PER_TURN} images. Work from computer_window_state or finish the turn.`,
      );
    }
    if (image.mimeType === "image/jpeg") {
      return [{ type: "image", data: image.data, mimeType: "image/jpeg" }] as Content[];
    }
    const encoded = yield* services.host
      .encodeJpeg(image.data)
      .pipe(Effect.mapError((error) => refusal("computer_protocol", error.message)));
    return [
      { type: "text", text: `Screenshot ${encoded.width}x${encoded.height}.` },
      { type: "image", data: encoded.data, mimeType: "image/jpeg" },
    ] as Content[];
  });

// Action results carry Cua's effect classification; an escalation says which rung to try next.
// The closing `Window:` line names the target for the model and the chat timeline.
export const actionContent = (result: CuaToolResult, window: CuaWindow): McpToolCallResult => {
  const outcome = Schema.decodeUnknownOption(CuaActionOutcome)(result.structuredContent);
  const lines = [resultText(result) || "Done."];
  if (Option.isSome(outcome)) {
    lines.push(`Effect: ${outcome.value.effect}.`);
    const escalation = outcome.value.escalation;
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
  }
  lines.push(`Window: ${window.app_name} ${JSON.stringify(window.title)}`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(Option.isSome(outcome) && outcome.value.effect === "refused" ? { isError: true } : {}),
  };
};

// One input action on a window: resolve and authorize it, run the Cua tool, report the outcome.
export const windowAction = (
  services: ComputerToolServices,
  context: ToolContext,
  input: { readonly pid: number; readonly window_id: number },
  scope: ComputerAccessScope,
  call: { readonly tool: string; readonly args: Readonly<Record<string, unknown>> },
) =>
  windowFor(services, context, input, scope).pipe(
    Effect.flatMap((window) =>
      callCua(services, context, call.tool, call.args).pipe(
        Effect.map((result) => actionContent(result, window)),
      ),
    ),
  );

// Chords like "cmd+shift+s" go to Cua's hotkey; single keys to press_key.
export const keyCall = (key: string) => {
  const parts = key.split("+").map((part) => part.trim().toLowerCase());
  return parts.length > 1
    ? { tool: "hotkey", args: { keys: parts } }
    : { tool: "press_key", args: { key: parts[0] } };
};

export interface ComputerToolSpec<Input> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: Schema.Codec<Input, unknown>;
  readonly readOnly: boolean;
  readonly run: (
    input: Input,
    context: ToolContext,
  ) => Effect.Effect<McpToolCallResult, GatewayToolError>;
}

export function computerTool<Input>(
  services: ComputerToolServices,
  spec: ComputerToolSpec<Input>,
): ToolEntry {
  const decode = Schema.decodeUnknownEffect(spec.input);
  return {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    listedFor: (threadId) => isComputerUseOn(services, threadId),
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: toolInputSchema(spec.input),
      annotations: {
        title: spec.title,
        readOnlyHint: spec.readOnly,
        destructiveHint: !spec.readOnly,
        idempotentHint: spec.readOnly,
        openWorldHint: true,
      },
    },
    handler: (args, context) =>
      requireComputerUse(services, context).pipe(
        Effect.andThen(
          decode(args).pipe(
            Effect.mapError((error) =>
              refusal("invalid_input", `Invalid ${spec.name} input: ${error.message}`),
            ),
          ),
        ),
        Effect.flatMap((input) => spec.run(input, context)),
        Effect.catch((error) => Effect.succeed(gatewayToolErrorResult(error))),
      ),
  };
}
