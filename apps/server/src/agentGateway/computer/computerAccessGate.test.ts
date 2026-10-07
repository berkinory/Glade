import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Fiber, Layer, Schema, Stream } from "effect";
import * as FS from "node:fs";

import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import { CuaToolResult } from "../../computer/cuaResults.ts";
import { ComputerAccessLive } from "../../computer/Layers/ComputerAccess.ts";
import { ComputerAccess } from "../../computer/Services/ComputerAccess.ts";
import { ComputerHost, type ComputerHostShape } from "../../computer/Services/ComputerHost.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ThreadComputerUseLive } from "../../orchestration/Layers/ThreadComputerUse.ts";
import { ThreadComputerUse } from "../../orchestration/Services/ThreadComputerUse.ts";
import type { McpToolCallResult } from "../protocol.ts";
import type { ToolContext, ToolEntry } from "../toolRuntime.ts";
import { makePixelComputerTools } from "./pixelTools.ts";
import { makeStructuredComputerTools } from "./structuredTools.ts";

const THREAD = ThreadId.makeUnsafe("thread-gate");
const TURN = "turn-gate";
// The Glade (Dev) window of the captured fixtures.
const WINDOW = { pid: 99747, window_id: 1546 };

const fixture = (name: string) =>
  Schema.decodeUnknownSync(CuaToolResult)(
    JSON.parse(
      FS.readFileSync(
        new URL(`../../computer/fixtures/cua-0.34.0-${name}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );

// One window per app category next to the captured Glade (Dev) window.
const APPS = {
  browser: { pid: 101, window_id: 11, name: "Safari", bundle: "com.apple.Safari" },
  terminal: { pid: 102, window_id: 12, name: "Terminal", bundle: "com.apple.Terminal" },
  other: { pid: 103, window_id: 13, name: "TextEdit", bundle: "com.apple.TextEdit" },
} as const;
const APP_LIST = [
  ...Object.values(APPS),
  {
    pid: WINDOW.pid,
    window_id: WINDOW.window_id,
    name: "Glade (Dev)",
    bundle: "com.agent.glade.dev",
  },
];
const target = (app: keyof typeof APPS) => ({ pid: APPS[app].pid, window_id: APPS[app].window_id });

const cuaResult = (structuredContent: Record<string, unknown>) =>
  Effect.succeed(
    Schema.decodeUnknownSync(CuaToolResult)({
      content: [{ type: "text", text: "ok" }],
      structuredContent,
    }),
  );

// Cua itself is stubbed with captured results. Input actions answer with `effect`, or never
// finish when it is null so Stop has something to stop. The engine records dispatched commands and
// holds only the thread's permission mode.
const setup = Effect.fnUntraced(function* (
  effect: "confirmed" | "unverifiable" | null = null,
  runtimeMode: RuntimeMode = "approval-required",
) {
  const calls: string[] = [];
  const dispatched: OrchestrationCommand[] = [];
  const windows = fixture("list_windows").structuredContent?.windows as ReadonlyArray<unknown>;
  const host: ComputerHostShape = {
    configured: true,
    status: Stream.empty,
    currentStatus: Effect.die("unused"),
    callTool: (name) => {
      calls.push(name);
      switch (name) {
        case "list_windows":
          return cuaResult({
            windows: [
              ...windows,
              ...Object.values(APPS).map((app) => ({
                window_id: app.window_id,
                pid: app.pid,
                app_name: app.name,
                title: "Untitled",
                bounds: { x: 0, y: 0, width: 800, height: 600 },
                is_on_screen: true,
                z_index: 1,
              })),
            ],
          });
        case "list_apps":
          return cuaResult({
            apps: APP_LIST.map((app) => ({
              pid: app.pid,
              name: app.name,
              running: true,
              active: false,
              bundle_id: app.bundle,
            })),
          });
        case "get_window_state":
          return Effect.succeed(fixture("get_window_state"));
        default:
          return effect === null ? Effect.never : cuaResult({ effect, route: "synthetic_events" });
      }
    },
    endSession: () => Effect.void,
    endAllSessions: Effect.void,
    userIdleSeconds: Effect.succeed(null),
    killSwitch: Stream.empty,
    encodeJpeg: () => Effect.die("unused"),
  };
  // Only the engine members ComputerAccess uses; the read model holds just this thread's mode.
  const engine = Layer.succeed(OrchestrationEngineService, {
    streamDomainEvents: Stream.never,
    getReadModel: () => Effect.succeed({ threads: [{ id: THREAD, runtimeMode }] }),
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => ({ sequence: dispatched.push(command) })),
  } as never);
  const access = yield* ComputerAccess.asEffect().pipe(
    Effect.provide(
      ComputerAccessLive.pipe(Layer.provide([engine, Layer.succeed(ComputerHost, host)])),
    ),
  );
  const computerUse = Effect.runSync(
    ThreadComputerUse.asEffect().pipe(Effect.provide(ThreadComputerUseLive)),
  );
  computerUse.set(THREAD, "on");
  const services = { host, access, computerUse };
  const tools = new Map(
    [...makeStructuredComputerTools(services), ...makePixelComputerTools(services)].map(
      (tool): [string, ToolEntry] => [tool.definition.name, tool],
    ),
  );
  const contextFor = (turnId: string): ToolContext => ({
    principal: {
      kind: "provider-session",
      sessionKey: "session-gate",
      threadId: THREAD,
      provider: "codex",
      turnId,
    },
    callerThreadId: THREAD,
    callerThreadLabel: null,
    callerSessionKey: "session-gate",
    callerProvider: "codex",
    callerCapabilities: new Set(["thread:write"]),
    callerTurnId: turnId,
    assertCallerTurnActive: () => Effect.void,
    jsonRpcRequestId: 1,
  });
  const call = (name: string, args: Record<string, unknown>, turnId = TURN) =>
    tools.get(name)!.handler(args, contextFor(turnId));
  const errorCode = (result: McpToolCallResult) => {
    const first = result.content[0];
    return result.isError && first?.type === "text"
      ? (JSON.parse(first.text) as { error?: { code?: string } }).error?.code
      : undefined;
  };
  const grant = (app: string, scope: ComputerAccessScope) =>
    access.grants.grant(THREAD, {
      app,
      windowId: null,
      windowTitle: null,
      scope,
      grantedAt: "2026-10-07T00:00:00.000Z",
      autoGrantedIn: null,
    });
  const activityKinds = () =>
    dispatched.flatMap((command) =>
      command.type === "thread.activity.append" ? [command.activity.kind] : [],
    );
  return { access, calls, call, errorCode, grant, activityKinds };
});

describe("computer access gate", () => {
  it.effect("refuses an ungranted window before Cua sees the call", () =>
    Effect.gen(function* () {
      const { calls, call, errorCode } = yield* setup();
      const result = yield* call("computer_window_state", WINDOW);
      assert.strictEqual(errorCode(result), "access_required");
      assert.notInclude(calls, "get_window_state");
    }),
  );

  it.effect("passes a granted window and only within the granted scope", () =>
    Effect.gen(function* () {
      const { access, calls, call, errorCode } = yield* setup();
      access.grants.grant(THREAD, {
        app: "glade (dev)",
        windowId: null,
        windowTitle: null,
        scope: "read",
        grantedAt: "2026-10-07T00:00:00.000Z",
        autoGrantedIn: null,
      });
      const state = yield* call("computer_window_state", WINDOW);
      assert.isUndefined(state.isError);
      assert.include(calls, "get_window_state");
      const act = yield* call("computer_act", { ...WINDOW, action: "click", element: 2 });
      assert.strictEqual(errorCode(act), "access_required");
    }),
  );

  it.effect("Stop cancels the in-flight call and the rest of that turn", () =>
    Effect.gen(function* () {
      const { access, calls, call, errorCode } = yield* setup();
      access.grants.grant(THREAD, {
        app: "Glade (Dev)",
        windowId: WINDOW.window_id,
        windowTitle: null,
        scope: "full",
        grantedAt: "2026-10-07T00:00:00.000Z",
        autoGrantedIn: null,
      });
      yield* call("computer_window_state", WINDOW);
      const click = yield* call("computer_act", { ...WINDOW, action: "click", element: 2 }).pipe(
        Effect.forkChild,
      );
      while (!calls.includes("click")) yield* Effect.yieldNow;
      access.tasks.stop(THREAD, TURN);
      assert.strictEqual(errorCode(yield* Fiber.join(click)), "stopped");
      const again = yield* call("computer_act", {
        ...WINDOW,
        action: "click",
        element: 2,
        delivery: "foreground",
      });
      assert.strictEqual(errorCode(again), "stopped");
      const nextTurn = yield* call("computer_window_state", WINDOW, "turn-next");
      assert.isUndefined(nextTurn.isError);
    }),
  );

  const click = { coordinate: [40, 40] };
  const typing = { text: "rm -rf ~" };
  it.effect.each([
    [
      "a browser refuses input even under full control",
      "browser",
      "full",
      "computer_left_click",
      click,
      "browser_read_only",
    ],
    ["a browser can still be read", "browser", "read", "computer_window_state", {}, undefined],
    [
      "a terminal refuses typing under act",
      "terminal",
      "act",
      "computer_type",
      typing,
      "click_only",
    ],
    [
      "a terminal refuses keys under act",
      "terminal",
      "act",
      "computer_key",
      { text: "return" },
      "click_only",
    ],
    [
      "a terminal refuses a right-click under act",
      "terminal",
      "act",
      "computer_right_click",
      click,
      "click_only",
    ],
    [
      "a terminal takes a plain click under act",
      "terminal",
      "act",
      "computer_left_click",
      click,
      undefined,
    ],
    [
      "a terminal takes typing under full control",
      "terminal",
      "full",
      "computer_type",
      typing,
      undefined,
    ],
    ["any other app takes typing under act", "other", "act", "computer_type", typing, undefined],
    [
      "the file dialog's desktop keys need full control",
      "other",
      "act",
      "computer_file_dialog",
      { action: "save", path: "/tmp" },
      "access_required",
    ],
  ] as const)("%s", ([, app, scope, tool, args, refusal]) =>
    Effect.gen(function* () {
      const { call, errorCode, grant } = yield* setup("confirmed");
      grant(APPS[app].name, scope);
      const result = yield* call(tool, { ...target(app), ...args });
      assert.strictEqual(errorCode(result), refusal);
    }),
  );

  it.live("refuses a third identical action without effect until the window is read", () =>
    Effect.gen(function* () {
      const { calls, call, errorCode, grant } = yield* setup("unverifiable");
      grant("TextEdit", "act");
      const clickTextEdit = call("computer_left_click", { ...target("other"), ...click });
      const clicks = () => calls.filter((name) => name === "click").length;
      assert.isUndefined(errorCode(yield* clickTextEdit));
      assert.isUndefined(errorCode(yield* clickTextEdit));
      assert.strictEqual(errorCode(yield* clickTextEdit), "no_progress");
      assert.strictEqual(clicks(), 2);
      yield* call("computer_window_state", target("other"));
      assert.isUndefined(errorCode(yield* clickTextEdit));
      assert.strictEqual(clicks(), 3);
    }),
  );

  it.effect.each([
    ["full-access grants full control on first use", "full-access", undefined, "full"],
    ["auto grants background input on first use", "auto", undefined, "act"],
    ["approval-required asks before any input", "approval-required", "access_required", null],
  ] as const)("%s", ([, mode, refusal, autoScope]) =>
    Effect.gen(function* () {
      const { access, call, errorCode, activityKinds } = yield* setup("confirmed", mode);
      const click = yield* call("computer_left_click", { ...target("other"), coordinate: [4, 4] });
      assert.strictEqual(errorCode(click), refusal);
      const granted = access.grants.check(THREAD, { app: "TextEdit", windowId: null }, "read");
      assert.strictEqual(granted?.scope ?? null, autoScope);
      assert.notInclude(activityKinds(), "user-input.requested");

      const fullRequest = yield* call("computer_request_access", {
        app: "TextEdit",
        scope: "full",
        reason: "drag a file",
      }).pipe(Effect.forkChild);
      while (!fullRequest.pollUnsafe() && !activityKinds().includes("user-input.requested")) {
        yield* Effect.yieldNow;
      }
      assert.strictEqual(activityKinds().includes("user-input.requested"), mode !== "full-access");
      yield* Fiber.interrupt(fullRequest);
    }),
  );
});
