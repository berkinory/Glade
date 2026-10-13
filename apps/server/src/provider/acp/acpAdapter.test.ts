import { spawn } from "node:child_process";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Fiber, Stream } from "effect";

import type { AcpProviderProfile } from "./acpProviderProfile.ts";
import { makeAcpAdapter } from "./acpAdapter.ts";

// A scripted agent on the SDK's agent side of the protocol, run as a real child process so the
// adapter is exercised over stdio. The prompt text picks the scenario.
const FAKE_AGENT = `
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
const configOptions = (model = "m1") => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model,
    options: [{ value: "m1", name: "Model One" }, { value: "m2", name: "Model Two" }] },
  ...(model === "m2" ? [{ id: "reasoning", name: "Reasoning", category: "thought_level", type: "select",
    currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }] : []),
];
let model = "m1";
let cancelTurn;
new AgentSideConnection((client) => ({
  initialize: () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  authenticate: () => ({}),
  newSession: () => ({ sessionId: "native-1", configOptions: configOptions(model) }),
  loadSession: async ({ sessionId }) => {
    await client.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replayed" } } });
    return { configOptions: configOptions(model) };
  },
  setSessionConfigOption: ({ value }) => { model = value; return { configOptions: configOptions(model) }; },
  cancel: () => cancelTurn?.(),
  prompt: async ({ sessionId, prompt }) => {
    const text = prompt.at(-1)?.text ?? "";
    const say = (chunk) => client.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } } });
    if (text === "request-permission") {
      await client.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "rm -rf build", kind: "execute", status: "pending" } });
      const cancelled = new Promise((resolve) => { cancelTurn = () => resolve("cancelled"); });
      const permission = client.requestPermission({ sessionId, toolCall: { toolCallId: "tool-1", title: "rm -rf build", kind: "execute" },
        options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }] });
      const outcome = await Promise.race([permission.then((response) => response.outcome), cancelled]);
      if (outcome === "cancelled" || outcome.outcome === "cancelled") return { stopReason: "cancelled" };
      await say("chose " + outcome.optionId + " on " + model);
      return { stopReason: "end_turn" };
    }
    await say("hello ");
    await say("from " + model);
    return { stopReason: "end_turn" };
  },
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`;

const profile: AcpProviderProfile = {
  provider: "codex",
  displayName: "Fake agent",
  args: [],
  hiddenCommands: new Set(),
};

const makeAdapter = makeAcpAdapter({
  profile,
  defaultCwd: process.cwd(),
  gatewayCredentials: undefined,
  spawn: () =>
    spawn(process.execPath, ["--input-type=module", "-e", FAKE_AGENT], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      stdio: ["pipe", "pipe", "pipe"],
    }),
});

const THREAD = ThreadId.makeUnsafe("thread-acp");

const assistantText = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
  events
    .flatMap((event) =>
      event.type === "content.delta" && event.payload.streamKind === "assistant_text"
        ? [event.payload.delta]
        : [],
    )
    .join("");

describe("ACP adapter over stdio", () => {
  it.effect("lists each model with the settings the agent offers for it", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      const catalog = yield* adapter.listModels!({ provider: "codex" });
      assert.deepEqual(
        catalog.models.map((model) => [
          model.slug,
          model.optionDescriptors?.flatMap((option) =>
            option.type === "select"
              ? option.options.map((choice) => `${option.id}=${choice.id}`)
              : [],
          ) ?? [],
        ]),
        [
          ["m1", []],
          ["m2", ["effort=low", "effort=high"]],
        ],
      );
    }),
  );

  it.effect("runs a turn, applies the model selection and resumes without replaying history", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      const firstTurn = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD,
        runtimeMode: "full-access",
        modelSelection: { provider: "codex", model: "m2" },
      });
      yield* adapter.sendTurn({ threadId: THREAD, input: "hi" });
      const events = [...(yield* Fiber.join(firstTurn))];
      assert.deepEqual(
        events.map((event) => event.type).filter((type) => type !== "content.delta"),
        [
          "session.started",
          "thread.started",
          "session.state.changed",
          "turn.started",
          "item.started",
          "item.completed",
          "turn.completed",
        ],
      );
      assert.equal(assistantText(events), "hello from m2");
      assert.deepEqual(session.resumeCursor, { schemaVersion: 1, sessionId: "native-1" });

      yield* adapter.stopSession(THREAD);
      assert.isFalse(yield* adapter.hasSession(THREAD));

      const resumedTurn = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD,
        runtimeMode: "full-access",
        resumeCursor: session.resumeCursor,
      });
      yield* adapter.sendTurn({ threadId: THREAD, input: "again" });
      const resumed = [...(yield* Fiber.join(resumedTurn))];
      assert.notInclude(assistantText(resumed), "replayed");
      yield* adapter.stopAll();
    }),
  );

  it.effect("routes approvals in Supervised mode and cancels a pending one on interrupt", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "approval-required" });

      const approved = yield* adapter.streamEvents.pipe(
        Stream.tap((event) =>
          event.type === "request.opened" && event.requestId
            ? adapter.respondToRequest(
                THREAD,
                ApprovalRequestId.makeUnsafe(event.requestId),
                "accept",
              )
            : Effect.void,
        ),
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId: THREAD, input: "request-permission" });
      const approvedEvents = [...(yield* Fiber.join(approved))];
      assert.equal(assistantText(approvedEvents), "chose yes on m1");
      assert.deepEqual(
        approvedEvents.flatMap((event) =>
          event.type === "request.resolved" ? [event.payload.decision] : [],
        ),
        ["accept"],
      );

      const interrupted = yield* adapter.streamEvents.pipe(
        Stream.tap((event) =>
          event.type === "request.opened" ? adapter.interruptTurn(THREAD) : Effect.void,
        ),
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId: THREAD, input: "request-permission" });
      const interruptedEvents = [...(yield* Fiber.join(interrupted))];
      const completion = interruptedEvents.findLast((event) => event.type === "turn.completed");
      assert.equal(
        completion?.type === "turn.completed" ? completion.payload.state : undefined,
        "interrupted",
      );
      assert.deepEqual(
        interruptedEvents.flatMap((event) =>
          event.type === "request.resolved" ? [event.payload.decision] : [],
        ),
        ["cancel"],
      );
      yield* adapter.stopAll();
    }),
  );
});
