import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, Fiber, Schema, Stream } from "effect";
import * as FS from "node:fs";

import { makeComputerGrants } from "../../computer/computerGrants.ts";
import { makeComputerTasks } from "../../computer/computerTask.ts";
import { CuaToolResult } from "../../computer/cuaResults.ts";
import type { ComputerHostShape } from "../../computer/Services/ComputerHost.ts";
import { ThreadComputerUseLive } from "../../orchestration/Layers/ThreadComputerUse.ts";
import { ThreadComputerUse } from "../../orchestration/Services/ThreadComputerUse.ts";
import type { McpToolCallResult } from "../protocol.ts";
import type { ToolContext, ToolEntry } from "../toolRuntime.ts";
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

// Cua itself is stubbed with captured results; clicks never finish so Stop has something to stop.
function setup() {
  const calls: string[] = [];
  const host: ComputerHostShape = {
    configured: true,
    status: Stream.empty,
    currentStatus: Effect.die("unused"),
    callTool: (name) => {
      calls.push(name);
      if (name === "list_windows") return Effect.succeed(fixture("list_windows"));
      if (name === "get_window_state") return Effect.succeed(fixture("get_window_state"));
      return Effect.never;
    },
    endSession: () => Effect.void,
    encodeJpeg: () => Effect.die("unused"),
  };
  const access = {
    grants: makeComputerGrants(),
    tasks: makeComputerTasks(),
    requestAccess: () => Effect.die("unused"),
  };
  const computerUse = Effect.runSync(
    ThreadComputerUse.asEffect().pipe(Effect.provide(ThreadComputerUseLive)),
  );
  computerUse.set(THREAD, "on");
  const tools = new Map(
    makeStructuredComputerTools({ host, access, computerUse }).map((tool): [string, ToolEntry] => [
      tool.definition.name,
      tool,
    ]),
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
    return first?.type === "text"
      ? (JSON.parse(first.text) as { error?: { code?: string } }).error?.code
      : undefined;
  };
  return { access, calls, call, errorCode };
}

describe("computer access gate", () => {
  it.effect("refuses an ungranted window before Cua sees the call", () =>
    Effect.gen(function* () {
      const { calls, call, errorCode } = setup();
      const result = yield* call("computer_window_state", WINDOW);
      assert.strictEqual(errorCode(result), "access_required");
      assert.notInclude(calls, "get_window_state");
    }),
  );

  it.effect("passes a granted window and only within the granted scope", () =>
    Effect.gen(function* () {
      const { access, calls, call, errorCode } = setup();
      access.grants.grant(THREAD, {
        app: "glade (dev)",
        windowId: null,
        scope: "read",
        grantedAt: "2026-10-07T00:00:00.000Z",
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
      const { access, calls, call, errorCode } = setup();
      access.grants.grant(THREAD, {
        app: "Glade (Dev)",
        windowId: WINDOW.window_id,
        scope: "full",
        grantedAt: "2026-10-07T00:00:00.000Z",
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
});
