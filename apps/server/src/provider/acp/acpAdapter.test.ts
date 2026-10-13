import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Fiber, Stream } from "effect";

import type { AcpProviderProfile } from "./acpProviderProfile.ts";
import { makeAcpAdapter, type AcpAdapterDependencies } from "./acpAdapter.ts";

// A scripted agent on the SDK's agent side of the protocol, run as a real child process so the
// adapter is exercised over stdio. The prompt text picks the scenario.
const FAKE_AGENT = `
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
const configOptions = (model = "m1") => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model,
    options: [{ value: "m1", name: "Model One" }, { value: "m2", name: "Model Two" }] },
  ...(model === "m2" ? [
    { id: "reasoning", name: "Reasoning", category: "thought_level", type: "select",
      currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
    { id: "thinking", name: "Thinking", category: "thought_level", type: "select",
      currentValue: "true", options: [{ value: "false", name: "Off" }, { value: "true", name: "On" }] },
    { id: "fast", name: "Fast", category: "model_config", type: "select",
      currentValue: "false", options: [{ value: "false", name: "Off" }, { value: "true", name: "On" }] },
  ] : []),
];
let model = "m1";
let sessions = 0;
let cancelTurn;
new AgentSideConnection((client) => ({
  initialize: () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  authenticate: () => ({}),
  newSession: async () => {
    const sessionId = "native-" + ++sessions;
    await client.sessionUpdate({ sessionId, update: { sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "review", description: "Review changes" }, { name: "hidden", description: "" }] } });
    return { sessionId, configOptions: configOptions(model) };
  },
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
    if (text === "echo-context") {
      await say(prompt.slice(0, -1).map((block) => block.text).join(" | "));
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
  hiddenCommands: new Set(["hidden"]),
};

const spawned: ChildProcessWithoutNullStreams[] = [];

const adapterDependencies: AcpAdapterDependencies = {
  profile,
  defaultCwd: process.cwd(),
  attachmentsDir: process.cwd(),
  gatewayCredentials: undefined,
  spawn: () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", FAKE_AGENT], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    spawned.push(child);
    return child;
  },
};

const makeAdapter = makeAcpAdapter(adapterDependencies);

const THREAD = ThreadId.makeUnsafe("thread-acp");
const OTHER_THREAD = ThreadId.makeUnsafe("thread-acp-other");

// The fake agent reuses "tool-1" every turn; each turn's row and approval must still name its own call.
const toolCallIds = (events: ReadonlyArray<ProviderRuntimeEvent>) => [
  ...new Set(
    events.flatMap((event) => {
      if (event.type === "item.started" && event.payload.itemType === "command_execution") {
        return event.itemId ? [event.itemId] : [];
      }
      const args = event.type === "request.opened" ? event.payload.args : undefined;
      return typeof args === "object" && args !== null && "toolCallId" in args
        ? [String(args.toolCallId)]
        : [];
    }),
  ),
];

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
              : [`${option.id}:${option.currentValue}`],
          ) ?? [],
        ]),
        [
          ["m1", []],
          ["m2", ["effort=low", "effort=high", "thinking:true", "fastMode:false"]],
        ],
      );
    }),
  );

  it.effect("lists commands the agent announced before answering session/new", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "full-access" });
      const { commands } = yield* adapter.listCommands!({
        provider: "codex",
        cwd: process.cwd(),
        threadId: THREAD,
      });
      assert.deepEqual(commands, [{ name: "review", description: "Review changes" }]);
      yield* adapter.stopAll();
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

  it.effect("shares one agent process between chats until the last one stops", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      const before = spawned.length;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "full-access" });
      yield* adapter.startSession({ threadId: OTHER_THREAD, runtimeMode: "full-access" });
      assert.equal(spawned.length - before, 1);
      const agent = spawned.at(-1)!;

      // One reader: the adapter's event queue hands each event to a single consumer.
      const turns = (count: number) =>
        adapter.streamEvents.pipe(
          Stream.filter(
            (event) => event.type === "content.delta" || event.type === "turn.completed",
          ),
          Stream.scan({ done: 0, events: [] as ProviderRuntimeEvent[] }, (state, event) => ({
            done: state.done + (event.type === "turn.completed" ? 1 : 0),
            events: [...state.events, event],
          })),
          Stream.takeUntil((state) => state.done === count),
          Stream.runLast,
          Effect.map((state) => (state._tag === "Some" ? state.value.events : [])),
          Effect.forkChild,
        );
      const textOf = (events: ReadonlyArray<ProviderRuntimeEvent>, threadId: ThreadId) =>
        assistantText(events.filter((event) => event.threadId === threadId));

      const both = yield* turns(2);
      yield* adapter.sendTurn({ threadId: THREAD, input: "one" });
      yield* adapter.sendTurn({ threadId: OTHER_THREAD, input: "two" });
      const bothEvents = yield* Fiber.join(both);
      assert.equal(textOf(bothEvents, THREAD), "hello from m1");
      assert.equal(textOf(bothEvents, OTHER_THREAD), "hello from m1");

      yield* adapter.stopSession(THREAD);
      assert.isNull(agent.exitCode ?? agent.signalCode);
      const afterStop = yield* turns(1);
      yield* adapter.sendTurn({ threadId: OTHER_THREAD, input: "three" });
      assert.equal(textOf(yield* Fiber.join(afterStop), OTHER_THREAD), "hello from m1");

      yield* adapter.stopSession(OTHER_THREAD);
      assert.isNotNull(agent.exitCode ?? agent.signalCode);
    }),
  );

  it.effect("gives each chat a private process when the agent shares MCP servers per process", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAcpAdapter({
        ...adapterDependencies,
        profile: { ...profile, sharesMcpServersAcrossSessions: true },
        gatewayCredentials: {
          connectionForThread: (threadId) => ({
            url: "http://127.0.0.1:1/mcp",
            bearerToken: `token-${threadId}`,
          }),
          revokeSessionToken: () => undefined,
        },
      });
      const before = spawned.length;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "full-access" });
      yield* adapter.startSession({ threadId: OTHER_THREAD, runtimeMode: "full-access" });
      assert.equal(spawned.length - before, 2);
      yield* adapter.stopAll();
    }),
  );

  it.effect("compacts into a fresh native session that opens with the agent's summary", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "full-access" });
      const compaction = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === THREAD),
        Stream.takeUntil(
          (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.compactThread!(THREAD);
      const events = [...(yield* Fiber.join(compaction))];
      const restarted = events.findLast((event) => event.type === "thread.started");
      assert.notEqual(
        restarted?.type === "thread.started" ? restarted.payload.providerThreadId : undefined,
        undefined,
      );

      const next = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === THREAD),
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId: THREAD, input: "echo-context" });
      assert.include(
        assistantText([...(yield* Fiber.join(next))]),
        "Summary of the earlier conversation:\n\nhello from m1",
      );
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
      const approvedIds = toolCallIds(approvedEvents);
      const interruptedIds = toolCallIds(interruptedEvents);
      assert.lengthOf(approvedIds, 1);
      assert.lengthOf(interruptedIds, 1);
      assert.notEqual(approvedIds[0], interruptedIds[0]);
      yield* adapter.stopAll();
    }),
  );
});
