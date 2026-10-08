import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Random, Fiber, Exit } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { ProviderItemId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import {
  makeHarness,
  THREAD_ID,
  makeDeterministicRandomService,
  nextEvent,
  requireCanUseTool,
} from "./adapterTestFixtures";

const toolOptions = (toolUseID: string, extra: { readonly agentID?: string } = {}) => ({
  signal: new AbortController().signal,
  toolUseID,
  requestId: `request-${toolUseID}`,
  ...extra,
});

const emitMessageStart = (harness: ReturnType<typeof makeHarness>, id: string) =>
  harness.query.emit({
    type: "stream_event",
    session_id: `sdk-session-${id}`,
    uuid: `stream-${id}`,
    parent_tool_use_id: null,
    event: { type: "message_start", message: { id: `msg-${id}` } },
  } as unknown as SDKMessage);

const settledPermission = (promise: Promise<PermissionResult | null>) =>
  Effect.promise(() => promise).pipe(
    Effect.map((result) => result ?? assert.fail("Expected a permission result.")),
  );

const requestIdOf = (event: { readonly requestId?: string | undefined }) => {
  if (!event.requestId) return assert.fail("Expected a runtime request id.");
  return ApprovalRequestId.makeUnsafe(event.requestId);
};

describe("Claude approvals", () => {
  it.effect("keeps Auto reviewer-gated after accepting one request for the session", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "auto",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "approve this",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);
      emitMessageStart(harness, "approval-thread");
      yield* nextEvent("thread.started");

      const canUseTool = requireCanUseTool(harness);
      const permissionPromise = canUseTool(
        "Bash",
        { command: "pwd" },
        {
          ...toolOptions("tool-use-1"),
          suggestions: [{ type: "setMode", mode: "default", destination: "session" }],
        },
      );

      const requested = yield* nextEvent("request.opened");
      assert.deepEqual(requested.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-use-1"),
      });
      assert.deepEqual(requested.payload.args, {
        toolName: "Bash",
        input: { command: "pwd" },
        sessionApprovalAvailable: true,
        toolUseId: "tool-use-1",
      });

      yield* adapter.respondToRequest(session.threadId, requestIdOf(requested), "acceptForSession");

      const resolved = yield* nextEvent("request.resolved");
      assert.equal(resolved.requestId, requested.requestId);
      assert.equal(resolved.payload.decision, "acceptForSession");
      assert.deepEqual(resolved.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-use-1"),
      });

      const permissionResult = yield* settledPermission(permissionPromise);
      assert.equal(permissionResult.behavior, "allow");
      assert.deepEqual(
        (permissionResult as { readonly updatedPermissions?: unknown }).updatedPermissions,
        [{ type: "setMode", mode: "default", destination: "session" }],
      );

      const secondPermissionPromise = canUseTool(
        "Bash",
        { command: "git status" },
        toolOptions("tool-use-2"),
      );
      const secondRequested = yield* nextEvent("request.opened");
      assert.equal(secondRequested.payload.detail, "Bash: git status");
      yield* adapter.respondToRequest(session.threadId, requestIdOf(secondRequested), "decline");
      yield* nextEvent("request.resolved");
      const secondPermissionResult = yield* settledPermission(secondPermissionPromise);
      assert.equal(secondPermissionResult.behavior, "deny");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps credential values out of the tool approval detail", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const permissionPromise = requireCanUseTool(harness)(
        "mcp__github__create_issue",
        { repo: "glade", apiKey: "ghp_live_secret" },
        toolOptions("tool-use-secret-1"),
      );
      const requested = yield* nextEvent("request.opened");
      assert.equal(
        requested.payload.detail,
        'mcp__github__create_issue: {"repo":"glade","apiKey":"[redacted]"}',
      );

      yield* adapter.respondToRequest(session.threadId, requestIdOf(requested), "decline");
      yield* nextEvent("request.resolved");
      yield* settledPermission(permissionPromise);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("classifies Agent tools and read-only Claude tools correctly for approvals", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      const canUseTool = requireCanUseTool(harness);

      const agentPermissionPromise = canUseTool("Agent", {}, toolOptions("tool-agent-1"));
      const agentRequested = yield* nextEvent("request.opened");
      assert.equal(agentRequested.payload.requestType, "tool_approval");
      assert.equal(
        (agentRequested.payload.args as Record<string, unknown>).sessionApprovalAvailable,
        false,
      );
      yield* adapter.respondToRequest(session.threadId, requestIdOf(agentRequested), "accept");
      yield* nextEvent("request.resolved");
      yield* Effect.promise(() => agentPermissionPromise);

      const grepPermissionPromise = canUseTool(
        "Grep",
        { pattern: "foo", path: "src" },
        toolOptions("tool-grep-approval-1"),
      );
      const grepRequested = yield* nextEvent("request.opened");
      assert.equal(grepRequested.payload.requestType, "file_read_approval");
      yield* adapter.respondToRequest(session.threadId, requestIdOf(grepRequested), "accept");
      yield* nextEvent("request.resolved");
      yield* Effect.promise(() => grepPermissionPromise);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("handles AskUserQuestion via user-input.requested/resolved lifecycle", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "question turn",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);
      emitMessageStart(harness, "user-input-thread");
      yield* nextEvent("thread.started");

      const askInput = {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "React", description: "React.js" },
              { label: "Vue", description: "Vue.js" },
            ],
            multiSelect: false,
          },
        ],
      };
      const permissionPromise = requireCanUseTool(harness)(
        "AskUserQuestion",
        askInput,
        toolOptions("tool-ask-1"),
      );

      const requested = yield* nextEvent("user-input.requested");
      assert.equal(requested.payload.questions.length, 1);
      assert.equal(requested.payload.questions[0]?.question, "Which framework?");
      assert.deepEqual(requested.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-ask-1"),
      });

      yield* adapter.respondToUserInput(session.threadId, requestIdOf(requested), {
        Framework: "React",
      });

      const resolved = yield* nextEvent("user-input.resolved");
      assert.deepEqual(resolved.payload.answers, { "Which framework?": "React" });
      assert.deepEqual(resolved.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-ask-1"),
      });

      const permissionResult = yield* settledPermission(permissionPromise);
      assert.equal(permissionResult.behavior, "allow");
      const updatedInput = (permissionResult as { updatedInput: Record<string, unknown> })
        .updatedInput;
      assert.deepEqual(updatedInput.answers, { "Which framework?": "React" });
      assert.deepEqual(updatedInput.questions, askInput.questions);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("settles unanswered AskUserQuestion exactly once before terminal turn state", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "ask a question",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const permissionPromise = requireCanUseTool(harness)(
        "AskUserQuestion",
        {
          questions: [
            {
              question: "Continue?",
              header: "Continue",
              options: [{ label: "Yes", description: "Proceed" }],
              multiSelect: false,
            },
          ],
        },
        toolOptions("tool-ask-terminal", { agentID: "foreground-agent-terminal" }),
      );

      const requested = yield* nextEvent("user-input.requested");
      const requestId = requestIdOf(requested);

      const terminalLifecycleFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "user-input.resolved" || event.type === "turn.completed",
      ).pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

      harness.query.emit({
        type: "system",
        subtype: "task_updated",
        task_id: "foreground-agent-terminal",
        patch: { status: "completed" },
        session_id: "sdk-session-user-input-terminal",
        uuid: "task-updated-user-input-terminal",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-user-input-terminal",
        uuid: "result-user-input-terminal",
      } as unknown as SDKMessage);

      const terminalLifecycle = Array.from(yield* Fiber.join(terminalLifecycleFiber));
      assert.deepEqual(
        terminalLifecycle.map((event) => event.type),
        ["user-input.resolved", "turn.completed"],
      );
      const resolvedEvent = terminalLifecycle[0];
      if (resolvedEvent?.type !== "user-input.resolved") {
        return assert.fail("Expected user-input.resolved before turn.completed");
      }
      assert.equal(resolvedEvent.requestId, requested.requestId);
      assert.deepEqual(resolvedEvent.payload.answers, {});
      assert.equal(resolvedEvent.turnId, terminalLifecycle[1]?.turnId);

      const permissionResult = yield* settledPermission(permissionPromise);
      assert.deepEqual(permissionResult, {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);

      const lateResponse = yield* Effect.exit(
        adapter.respondToUserInput(session.threadId, requestId, { Continue: "Yes" }),
      );
      assert.equal(Exit.isFailure(lateResponse), true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect.each([
    {
      name: "user-input responses",
      runtimeMode: "full-access",
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            question: "Choose a mode",
            header: "Mode",
            options: [
              { label: "Safe", description: "Use safe mode" },
              { label: "Fast", description: "Use fast mode" },
            ],
            multiSelect: false,
          },
        ],
      },
    },
    {
      name: "approval decisions",
      runtimeMode: "approval-required",
      toolName: "Bash",
      toolInput: { command: "pwd" },
    },
  ] as const)("accepts exactly one of two concurrent $name", (row) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: row.runtimeMode,
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const permissionPromise = requireCanUseTool(harness)(
        row.toolName,
        row.toolInput,
        toolOptions("tool-racing"),
      );
      const isQuestion = row.toolName === "AskUserQuestion";
      const requested = isQuestion
        ? yield* nextEvent("user-input.requested")
        : yield* nextEvent("request.opened");
      const requestId = requestIdOf(requested);
      const respond = (choice: "first" | "second") =>
        Effect.exit(
          isQuestion
            ? adapter.respondToUserInput(session.threadId, requestId, {
                Mode: choice === "first" ? "Safe" : "Fast",
              })
            : adapter.respondToRequest(
                session.threadId,
                requestId,
                choice === "first" ? "accept" : "decline",
              ),
        );

      const responses = yield* Effect.all([respond("first"), respond("second")], {
        concurrency: "unbounded",
      });
      assert.equal(responses.filter(Exit.isSuccess).length, 1);
      assert.equal(responses.filter(Exit.isFailure).length, 1);

      const permissionResult = yield* settledPermission(permissionPromise);
      if (isQuestion) {
        yield* nextEvent("user-input.resolved");
        assert.equal(permissionResult.behavior, "allow");
      } else {
        const resolved = yield* nextEvent("request.resolved");
        assert.equal(
          permissionResult.behavior,
          resolved.payload.decision === "accept" ? "allow" : "deny",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
