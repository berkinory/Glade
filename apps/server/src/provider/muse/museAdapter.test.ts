import { spawn } from "node:child_process";

import { assert, describe, it } from "@effect/vitest";
import { ApprovalRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, Fiber, Stream } from "effect";

import { makeMuseAdapter } from "./museAdapter.ts";

// A scripted `muse serve` host speaking MSP over stdio, run as a real child process. The last text
// part of a turn picks the scenario; replies name what the host observed.
const FAKE_HOST = `
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const notify = (method, params) => send({ method, params });
const sessions = new Map();
let nextRequestId = 1000;
let pending;
const say = (sessionId, turnId, itemId, chunks) => {
  notify("item/started", { sessionId, item: { itemId, kind: "agentMessage", turnId, status: "inProgress", revision: 1, text: "" } });
  for (const delta of chunks) notify("item/delta", { sessionId, itemId, field: "text", delta });
  notify("item/completed", { sessionId, item: { itemId, kind: "agentMessage", turnId, status: "completed", revision: 2, text: chunks.join("") } });
};
const complete = (sessionId, turnId, terminal) => notify("turn/completed", { sessionId, turnId, terminal });
const opened = (sessionId) => ({ session: { sessionId, modelId: null, ...sessions.get(sessionId) } });
const handlers = {
  initialize: () => ({ schema: { version: 1 }, grantedCapabilities: [] }),
  "session/start": ({ approvalMode, permissionProfile }) => {
    sessions.set("native-1", { approvalMode: { mode: approvalMode }, permissionState: { profileId: permissionProfile } });
    return opened("native-1");
  },
  "session/resume": ({ sessionId, excludeItems }) => {
    if (sessionId !== "native-1") return { error: { code: -32020, message: "session not found", data: { kind: "sessionNotFound" } } };
    if (excludeItems !== true) return { error: { code: -32602, message: "history replay requested" } };
    sessions.set(sessionId, { approvalMode: { mode: "promptUnmatched" }, permissionState: { profileId: ":ask-me" } });
    return opened(sessionId);
  },
  "session/setApprovalMode": ({ sessionId, mode }) => { sessions.get(sessionId).approvalMode = { mode }; return {}; },
  "session/setPermissionProfile": ({ sessionId, profileId }) => { sessions.get(sessionId).permissionState = { profileId }; return {}; },
  "turn/start": ({ sessionId, commandId, input }) => {
    const turnId = commandId;
    const text = input.at(-1)?.text ?? "";
    setImmediate(() => {
      const state = sessions.get(sessionId);
      if (text !== "approve") {
        say(sessionId, turnId, "reply-" + turnId, ["hello ", "from " + sessionId + " parts=" + input.length + " " + state.approvalMode.mode + " " + state.permissionState.profileId]);
        complete(sessionId, turnId, "completed");
        return;
      }
      const tool = { itemId: "tool-" + turnId, kind: "toolCall", turnId, status: "inProgress", revision: 1, tool: "bash", args: JSON.stringify({ command: "rm -rf build" }) };
      notify("item/started", { sessionId, item: tool });
      pending = { sessionId, turnId, approvalId: "approval-" + turnId, tool };
      const request = {
        sessionId, turnId, approvalId: pending.approvalId, itemId: tool.itemId, toolCallId: "call-1", toolName: "bash",
        rawArgs: tool.args, currentRequirementId: { approvalId: pending.approvalId, sourceIndex: 0 },
        availableChoices: [
          { choiceId: "always", decision: "approvedPolicyAmendment", scope: "localPersistent", label: "Always" },
          { choiceId: "session", decision: "approvedForSession", scope: "session", label: "This session" },
          { choiceId: "once", decision: "approved", scope: "once", label: "Once" },
          { choiceId: "deny", decision: "denied", scope: "once", label: "Deny" },
        ],
        subject: { kind: "shell", command: "rm -rf build" },
      };
      send({ id: nextRequestId++, method: "approval/request", params: request });
      notify("approval/requested", request);
    });
    return { turnId, disposition: "started", startedNewTurn: true, status: "accepted", commandId };
  },
  "approval/decide": ({ choiceId }) => {
    const { sessionId, turnId, approvalId, tool } = pending;
    pending = undefined;
    setImmediate(() => {
      notify("approval/resolved", { sessionId, approvalId, decision: "approved" });
      notify("item/completed", { sessionId, item: { ...tool, status: "completed", revision: 2, visibleOutput: "done", exitCode: 0 } });
      say(sessionId, turnId, "reply-" + turnId, ["chose " + choiceId]);
      complete(sessionId, turnId, "completed");
    });
    return { terminal: true };
  },
  "turn/interrupt": ({ sessionId, turnId }) => {
    setImmediate(() => {
      if (pending) notify("approval/resolved", { sessionId, approvalId: pending.approvalId, decision: "abort" });
      pending = undefined;
      complete(sessionId, turnId, "cancelled");
    });
    return { turnId };
  },
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method || message.id === undefined) return;
  const result = handlers[message.method]?.(message.params ?? {});
  if (result?.error) send({ id: message.id, error: result.error });
  else send({ id: message.id, result: result ?? {} });
});
`;

const makeAdapter = makeMuseAdapter({
  defaultCwd: process.cwd(),
  gatewayCredentials: undefined,
  spawn: () =>
    spawn(process.execPath, ["--input-type=module", "-e", FAKE_HOST], {
      stdio: ["pipe", "pipe", "pipe"],
    }),
});

const THREAD = ThreadId.makeUnsafe("thread-muse");

const assistantText = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
  events
    .flatMap((event) =>
      event.type === "content.delta" && event.payload.streamKind === "assistant_text"
        ? [event.payload.delta]
        : [],
    )
    .join("");

const decisions = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
  events.flatMap((event) => (event.type === "request.resolved" ? [event.payload.decision] : []));

const untilTurnCompleted = <E, R>(events: Stream.Stream<ProviderRuntimeEvent, E, R>) =>
  events.pipe(
    Stream.takeUntil((event) => event.type === "turn.completed"),
    Stream.runCollect,
  );

describe("Muse Code adapter over stdio", () => {
  it.effect(
    "runs a turn, then resumes the native session without resending the harness policy",
    () =>
      Effect.gen(function* () {
        const adapter = yield* makeAdapter;
        const firstTurn = yield* untilTurnCompleted(adapter.streamEvents).pipe(Effect.forkChild);
        const session = yield* adapter.startSession({
          threadId: THREAD,
          runtimeMode: "approval-required",
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
        assert.equal(assistantText(events), "hello from native-1 parts=2 promptUnmatched :ask-me");
        assert.deepEqual(session.resumeCursor, { schemaVersion: 1, sessionId: "native-1" });
        yield* adapter.stopSession(THREAD);

        const resumedTurn = yield* untilTurnCompleted(adapter.streamEvents).pipe(Effect.forkChild);
        const resumed = yield* adapter.startSession({
          threadId: THREAD,
          runtimeMode: "full-access",
          resumeCursor: session.resumeCursor,
        });
        assert.isTrue(adapter.resumedNativeConversation!(session.resumeCursor, resumed));
        yield* adapter.sendTurn({ threadId: THREAD, input: "again" });
        assert.equal(
          assistantText([...(yield* Fiber.join(resumedTurn))]),
          "hello from native-1 parts=1 allowAll :unrestricted",
        );
        yield* adapter.stopSession(THREAD);

        const stale = { schemaVersion: 1, sessionId: "gone" };
        const fresh = yield* adapter.startSession({
          threadId: THREAD,
          runtimeMode: "approval-required",
          resumeCursor: stale,
        });
        assert.isFalse(adapter.resumedNativeConversation!(stale, fresh));
        yield* adapter.stopAll();
      }),
  );

  it.effect("asks in Supervised mode, cancels a pending approval on interrupt", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "approval-required" });

      const approved = yield* untilTurnCompleted(
        adapter.streamEvents.pipe(
          Stream.tap((event) =>
            event.type === "request.opened" && event.requestId
              ? adapter.respondToRequest(
                  THREAD,
                  ApprovalRequestId.makeUnsafe(event.requestId),
                  "accept",
                )
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);
      yield* adapter.sendTurn({ threadId: THREAD, input: "approve" });
      const approvedEvents = [...(yield* Fiber.join(approved))];
      const opened = approvedEvents.filter((event) => event.type === "request.opened");
      assert.equal(opened.length, 1);
      assert.equal(
        opened[0]?.type === "request.opened" ? opened[0].payload.requestType : undefined,
        "command_execution_approval",
      );
      assert.deepEqual(decisions(approvedEvents), ["accept"]);
      assert.equal(assistantText(approvedEvents), "chose once");
      const command = approvedEvents.find(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "command_execution",
      );
      assert.deepInclude(
        command?.type === "item.completed" ? (command.payload.data as object) : {},
        { input: { command: "rm -rf build" }, output: "done", exitCode: 0 },
      );

      const interrupted = yield* untilTurnCompleted(
        adapter.streamEvents.pipe(
          Stream.tap((event) =>
            event.type === "request.opened" ? adapter.interruptTurn(THREAD) : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);
      yield* adapter.sendTurn({ threadId: THREAD, input: "approve" });
      const interruptedEvents = [...(yield* Fiber.join(interrupted))];
      const completion = interruptedEvents.findLast((event) => event.type === "turn.completed");
      assert.equal(
        completion?.type === "turn.completed" ? completion.payload.state : undefined,
        "interrupted",
      );
      assert.deepEqual(decisions(interruptedEvents), ["cancel"]);
      yield* adapter.stopAll();
    }),
  );

  it.effect("allows each call once in Full Access without asking", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter;
      yield* adapter.startSession({ threadId: THREAD, runtimeMode: "full-access" });
      const turn = yield* untilTurnCompleted(adapter.streamEvents).pipe(Effect.forkChild);
      yield* adapter.sendTurn({ threadId: THREAD, input: "approve" });
      const events = [...(yield* Fiber.join(turn))];
      assert.isFalse(events.some((event) => event.type === "request.opened"));
      assert.equal(assistantText(events), "chose once");
      yield* adapter.stopAll();
    }),
  );
});
