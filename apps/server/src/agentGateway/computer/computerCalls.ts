import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { Effect, Option, Schema } from "effect";

import {
  categoryRefusal,
  type ActionClass,
  type AppIdentity,
} from "../../computer/appCategories.ts";
import { MAX_IMAGES_PER_TURN } from "../../computer/computerTask.ts";
import {
  CuaFailure,
  CuaListApps,
  CuaListWindows,
  CuaWindowState,
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
import { untrustedContent } from "../untrustedContent.ts";

export interface ComputerToolServices {
  readonly host: ComputerHostShape;
  readonly access: ComputerAccessShape;
  readonly computerUse: ThreadComputerUseShape;
}

export interface WindowInput {
  readonly pid: number;
  readonly window_id: number;
}

// What a tool needs from the grant (scope) and what it does to the app (action class, for the
// app category check).
export interface WindowNeed {
  readonly scope: ComputerAccessScope;
  readonly action: ActionClass;
}

type Content = McpToolCallResult["content"][number];

const CALL_TIMEOUT_MS = 30_000;
// Long edge of window screenshots handed to the model: the size Cua documents and current Claude
// and GPT models take without further downscaling. Passed explicitly because the driver's stored
// setting may be 0 (native Retina size). Cua scales its coordinate space to the image it returns,
// so pixel actions use the model's coordinates unchanged.
export const SCREENSHOT_MAX_EDGE = 1568;

const refusal = (code: string, message: string, details?: unknown) =>
  new GatewayToolError(code, message, details);
export const refuse = (code: string, message: string, details?: unknown) =>
  Effect.fail(refusal(code, message, details));

// Thread ownership comes from the gateway session (context.callerThreadId), never tool input.
export const callerThread = (context: ToolContext) => ThreadId.makeUnsafe(context.callerThreadId);

const isComputerUseOn = (services: ComputerToolServices, threadId: string) =>
  services.computerUse.mode(ThreadId.makeUnsafe(threadId)) !== "off";

// App-provided text (titles, accessibility labels and values) handed to the model.
export const appContent = (window: CuaWindow, text: string) =>
  untrustedContent(
    "APP_CONTENT",
    `app=${JSON.stringify(window.app_name)} window=${window.window_id}`,
    text,
  );

// Glade's report line naming the window a result is about, outside any APP_CONTENT block so the
// chat timeline can name the target.
export const windowLine = (window: CuaWindow) =>
  `Window: ${window.app_name} ${JSON.stringify(window.title)}`;

// One Cua tools/call in the caller thread's own Cua session, returned as Cua answered it (tool
// errors included). Stop aborts it, which cancels it in Cua.
export const callCuaResult = (
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
    return yield* Effect.raceFirst(
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
  });

// A Cua tool error as a typed refusal carrying Cua's code and text.
export const refuseCuaError = (name: string, result: CuaToolResult) => {
  const code = Schema.decodeUnknownOption(CuaFailure)(result.structuredContent).pipe(
    Option.map((failure) => failure.code),
    Option.getOrElse(() => "cua_error"),
  );
  return refuse(code, resultText(result) || `${name} failed.`);
};

// The same call, refusing when Cua answered with a tool error.
export const callCua = (
  services: ComputerToolServices,
  context: ToolContext,
  name: string,
  args: Readonly<Record<string, unknown>>,
  timeoutMs = CALL_TIMEOUT_MS,
) =>
  callCuaResult(services, context, name, args, timeoutMs).pipe(
    Effect.flatMap((result) =>
      result.isError ? refuseCuaError(name, result) : Effect.succeed(result),
    ),
  );

const requireComputerUse = (services: ComputerToolServices, context: ToolContext) =>
  isComputerUseOn(services, context.callerThreadId)
    ? Effect.void
    : refuse(
        "computer_use_off",
        "Computer Use is off for this thread. Ask the user to turn it on with /computer or the thread menu.",
      );

// The window as Cua lists it now: the grant check needs its app, and a pid/window pair that does
// not match is refused before anything acts on it.
const resolveWindow = (services: ComputerToolServices, context: ToolContext, input: WindowInput) =>
  Effect.gen(function* () {
    const listed = yield* callCua(services, context, "list_windows", { pid: input.pid });
    const windows = Schema.decodeUnknownOption(CuaListWindows)(listed.structuredContent).pipe(
      Option.map((value) => value.windows),
      Option.getOrElse((): ReadonlyArray<CuaWindow> => []),
    );
    // Cua can list other processes' windows too. Later calls pass the agent's pid to Cua, so the
    // granted window must belong to that pid.
    const window = windows.find(
      (entry) => entry.window_id === input.window_id && entry.pid === input.pid,
    );
    if (!window) {
      return yield* refuse(
        "window_not_found",
        `pid ${input.pid} has no window ${input.window_id}. Call computer_apps for current pids and window ids.`,
      );
    }
    return window;
  });

// The running app's identity by pid. An app Cua does not list as a regular app (a menu-bar
// accessory) is known by its window's name only and falls in no restricted category.
const appIdentity = (
  services: ComputerToolServices,
  context: ToolContext,
  pid: number,
  name: string,
) =>
  Effect.gen(function* () {
    const cached = services.access.apps.get(pid, name);
    if (cached) return cached;
    const listed = yield* callCua(services, context, "list_apps", {});
    const app = Schema.decodeUnknownOption(CuaListApps)(listed.structuredContent).pipe(
      Option.flatMap((value) =>
        Option.fromNullishOr(value.apps.find((entry) => entry.running && entry.pid === pid)),
      ),
    );
    const identity: AppIdentity = Option.match(app, {
      onNone: () => ({ name, bundleId: null, launchPath: null }),
      onSome: (value) => ({
        name,
        bundleId: value.bundle_id ?? null,
        launchPath: value.launch_path ?? null,
      }),
    });
    services.access.apps.set(pid, name, identity);
    return identity;
  });

const SCOPE_NEEDS: Record<ComputerAccessScope, string> = {
  read: "read access",
  act: "act access",
  full: "full control",
};

// The gate every window-scoped tool passes before Cua sees the call: the thread's grant (recorded on
// first use when the thread's permission mode allows), then the target app's category, checked
// against the app that owns the window right now.
const authorize = (
  services: ComputerToolServices,
  context: ToolContext,
  window: CuaWindow,
  need: WindowNeed,
) =>
  Effect.gen(function* () {
    const grant = yield* services.access.grantFor({
      threadId: callerThread(context),
      turnId: context.callerTurnId,
      app: window.app_name,
      windowId: window.window_id,
      scope: need.scope,
    });
    if (!grant) {
      return yield* refuse(
        "access_required",
        `This thread has no ${SCOPE_NEEDS[need.scope]} to ${window.app_name}. Call computer_request_access with app "${window.app_name}" and scope "${need.scope}", then retry.`,
      );
    }
    if (need.action === "read" || window.pid === null) return;
    const app = yield* appIdentity(services, context, window.pid, window.app_name);
    const refused = categoryRefusal(app, need.action, grant.scope);
    if (refused) return yield* refuse(refused.code, refused.message);
  });

export const windowFor = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  need: WindowNeed,
) =>
  resolveWindow(services, context, input).pipe(
    Effect.tap((window) => authorize(services, context, window, need)),
  );

// How a window read was narrowed: not at all, by a depth limit, or by a query.
export type ReadScope = "full" | "depth" | "query";

// A fresh tree of the window under Glade's stable indexes, and what changed since the last one.
export const recordSnapshot = (
  services: ComputerToolServices,
  context: ToolContext,
  input: WindowInput,
  result: CuaToolResult,
  scope: ReadScope,
) => {
  const state = Schema.decodeUnknownOption(CuaWindowState)(result.structuredContent);
  const truncated = Option.isNone(state) || state.value.truncated === true;
  const recorded = services.access.snapshots.record(
    callerThread(context),
    { pid: input.pid, windowId: input.window_id },
    Option.match(state, { onNone: () => [], onSome: (value) => value.elements ?? [] }),
    scope === "query" ? "filtered" : scope === "depth" || truncated ? "partial" : "complete",
  );
  return { state, ...recorded };
};

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
        // Any look at an app (tree, screenshot, zoom, verify) ends a run of fruitless repeats.
        Effect.tap(() =>
          spec.readOnly
            ? Effect.sync(() => services.access.progress.recordRead(context.callerThreadId))
            : Effect.void,
        ),
        Effect.flatMap((input) => spec.run(input, context)),
        Effect.catch((error) => Effect.succeed(gatewayToolErrorResult(error))),
      ),
  };
}
