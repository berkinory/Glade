import { describe, it, assert } from "@effect/vitest";
import { Effect, Stream, Random, Fiber, Exit } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { ProviderItemId, ApprovalRequestId } from "@glade/contracts/core/baseSchemas";
import { makeHarness, THREAD_ID, makeDeterministicRandomService } from "./adapterTestFixtures";

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

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-approval-1",
        uuid: "stream-approval-thread",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-approval-thread",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag !== "Some" || threadStarted.value.type !== "thread.started") {
        return;
      }

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "Bash",
        { command: "pwd" },
        {
          signal: new AbortController().signal,
          suggestions: [
            {
              type: "setMode",
              mode: "default",
              destination: "session",
            },
          ],
          toolUseID: "tool-use-1",
          requestId: "request-tool-use-1",
        },
      );

      const requested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requested._tag, "Some");
      if (requested._tag !== "Some") {
        return;
      }
      assert.equal(requested.value.type, "request.opened");
      if (requested.value.type !== "request.opened") {
        return;
      }
      assert.deepEqual(requested.value.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-use-1"),
      });
      assert.deepEqual(requested.value.payload.args, {
        toolName: "Bash",
        input: { command: "pwd" },
        sessionApprovalAvailable: true,
        toolUseId: "tool-use-1",
      });
      const runtimeRequestId = requested.value.requestId;
      assert.equal(typeof runtimeRequestId, "string");
      if (runtimeRequestId === undefined) {
        return;
      }

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.makeUnsafe(runtimeRequestId),
        "acceptForSession",
      );

      const resolved = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolved._tag, "Some");
      if (resolved._tag !== "Some") {
        return;
      }
      assert.equal(resolved.value.type, "request.resolved");
      if (resolved.value.type !== "request.resolved") {
        return;
      }
      assert.equal(resolved.value.requestId, requested.value.requestId);
      assert.equal(resolved.value.payload.decision, "acceptForSession");
      assert.deepEqual(resolved.value.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-use-1"),
      });

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      const allowedPermissionResult = permissionResult as {
        readonly behavior?: string;
        readonly updatedPermissions?: unknown;
      } | null;
      assert.equal(allowedPermissionResult?.behavior, "allow");
      assert.deepEqual(allowedPermissionResult?.updatedPermissions, [
        {
          type: "setMode",
          mode: "default",
          destination: "session",
        },
      ]);

      const secondPermissionPromise = canUseTool(
        "Bash",
        { command: "git status" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-use-2",
          requestId: "request-tool-use-2",
        },
      );
      const secondRequested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(secondRequested._tag, "Some");
      if (secondRequested._tag !== "Some" || secondRequested.value.type !== "request.opened") {
        return;
      }
      assert.equal(secondRequested.value.payload.detail, "Bash: git status");
      const secondRuntimeRequestId = secondRequested.value.requestId;
      if (secondRuntimeRequestId === undefined) {
        return;
      }
      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.makeUnsafe(secondRuntimeRequestId),
        "decline",
      );
      yield* Stream.runHead(adapter.streamEvents);
      const secondPermissionResult = yield* Effect.promise(() => secondPermissionPromise);
      assert.equal((secondPermissionResult as PermissionResult).behavior, "deny");
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

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "mcp__github__create_issue",
        { repo: "glade", apiKey: "ghp_live_secret" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-use-secret-1",
          requestId: "request-tool-use-secret-1",
        },
      );
      const requested = yield* Stream.runHead(adapter.streamEvents);
      if (requested._tag !== "Some" || requested.value.type !== "request.opened") {
        assert.fail("expected the tool approval to open");
        return;
      }
      assert.equal(
        requested.value.payload.detail,
        'mcp__github__create_issue: {"repo":"glade","apiKey":"[redacted]"}',
      );

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.makeUnsafe(String(requested.value.requestId)),
        "decline",
      );
      yield* Stream.runHead(adapter.streamEvents);
      yield* Effect.promise(() => permissionPromise);
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

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const agentPermissionPromise = canUseTool(
        "Agent",
        {},
        {
          signal: new AbortController().signal,
          toolUseID: "tool-agent-1",
          requestId: "request-tool-agent-1",
        },
      );

      const agentRequested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(agentRequested._tag, "Some");
      if (agentRequested._tag !== "Some" || agentRequested.value.type !== "request.opened") {
        return;
      }
      assert.equal(agentRequested.value.payload.requestType, "tool_approval");
      assert.equal(
        (agentRequested.value.payload.args as Record<string, unknown>).sessionApprovalAvailable,
        false,
      );

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.makeUnsafe(String(agentRequested.value.requestId)),
        "accept",
      );
      yield* Stream.runHead(adapter.streamEvents);
      yield* Effect.promise(() => agentPermissionPromise);

      const grepPermissionPromise = canUseTool(
        "Grep",
        { pattern: "foo", path: "src" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-grep-approval-1",
          requestId: "request-tool-grep-approval-1",
        },
      );

      const grepRequested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(grepRequested._tag, "Some");
      if (grepRequested._tag !== "Some" || grepRequested.value.type !== "request.opened") {
        return;
      }
      assert.equal(grepRequested.value.payload.requestType, "file_read_approval");

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.makeUnsafe(String(grepRequested.value.requestId)),
        "accept",
      );
      yield* Stream.runHead(adapter.streamEvents);
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

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-user-input-1",
        uuid: "stream-user-input-thread",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-user-input-thread",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag !== "Some" || threadStarted.value.type !== "thread.started") {
        return;
      }

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

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

      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        toolUseID: "tool-ask-1",
        requestId: "request-tool-ask-1",
      });

      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requestedEvent._tag, "Some");
      if (requestedEvent._tag !== "Some") {
        return;
      }
      assert.equal(requestedEvent.value.type, "user-input.requested");
      if (requestedEvent.value.type !== "user-input.requested") {
        return;
      }
      const requestId = requestedEvent.value.requestId;
      assert.equal(typeof requestId, "string");
      assert.equal(requestedEvent.value.payload.questions.length, 1);
      assert.equal(requestedEvent.value.payload.questions[0]?.question, "Which framework?");
      assert.deepEqual(requestedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-ask-1"),
      });

      yield* adapter.respondToUserInput(
        session.threadId,
        ApprovalRequestId.makeUnsafe(requestId!),
        { Framework: "React" },
      );

      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolvedEvent._tag, "Some");
      if (resolvedEvent._tag !== "Some") {
        return;
      }
      assert.equal(resolvedEvent.value.type, "user-input.resolved");
      if (resolvedEvent.value.type !== "user-input.resolved") {
        return;
      }
      assert.deepEqual(resolvedEvent.value.payload.answers, {
        "Which framework?": "React",
      });
      assert.deepEqual(resolvedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-ask-1"),
      });

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "allow");
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

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      if (!canUseTool) {
        assert.fail("Expected canUseTool to be defined");
        return;
      }

      const permissionPromise = canUseTool(
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
        {
          signal: new AbortController().signal,
          toolUseID: "tool-ask-terminal",
          agentID: "foreground-agent-terminal",
          requestId: "request-tool-ask-terminal",
        },
      );

      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "user-input.requested") {
        assert.fail("Expected user-input.requested event");
        return;
      }
      const rawRequestId = requestedEvent.value.requestId;
      if (!rawRequestId) {
        assert.fail("Expected user-input request id");
        return;
      }
      const requestId = ApprovalRequestId.makeUnsafe(rawRequestId);

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
        assert.fail("Expected user-input.resolved before turn.completed");
        return;
      }
      assert.equal(resolvedEvent.requestId, rawRequestId);
      assert.deepEqual(resolvedEvent.payload.answers, {});
      assert.equal(resolvedEvent.turnId, terminalLifecycle[1]?.turnId);

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.deepEqual(permissionResult, {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);

      const lateResponse = yield* Effect.exit(
        adapter.respondToUserInput(session.threadId, requestId, {
          Continue: "Yes",
        }),
      );
      assert.equal(Exit.isFailure(lateResponse), true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("accepts exactly one of two concurrent user-input responses", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      if (!canUseTool) {
        assert.fail("Expected canUseTool to be defined");
        return;
      }
      const permissionPromise = canUseTool(
        "AskUserQuestion",
        {
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
        {
          signal: new AbortController().signal,
          toolUseID: "tool-racing-question",
          requestId: "request-racing-question",
        },
      );
      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "user-input.requested") {
        assert.fail("Expected user-input.requested event");
        return;
      }
      const requestId = ApprovalRequestId.makeUnsafe(requestedEvent.value.requestId!);

      const responses = yield* Effect.all(
        [
          Effect.exit(adapter.respondToUserInput(session.threadId, requestId, { Mode: "Safe" })),
          Effect.exit(adapter.respondToUserInput(session.threadId, requestId, { Mode: "Fast" })),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(responses.filter(Exit.isSuccess).length, 1);
      assert.equal(responses.filter(Exit.isFailure).length, 1);

      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolvedEvent._tag, "Some");
      assert.equal(
        resolvedEvent._tag === "Some" && resolvedEvent.value.type,
        "user-input.resolved",
      );
      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "allow");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("accepts exactly one of two concurrent approval decisions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      if (!canUseTool) {
        assert.fail("Expected canUseTool to be defined");
        return;
      }
      const permissionPromise = canUseTool(
        "Bash",
        { command: "pwd" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-racing-approval",
          requestId: "request-racing-approval",
        },
      );
      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "request.opened") {
        assert.fail("Expected request.opened event");
        return;
      }
      const requestId = ApprovalRequestId.makeUnsafe(requestedEvent.value.requestId!);

      const responses = yield* Effect.all(
        [
          Effect.exit(adapter.respondToRequest(session.threadId, requestId, "accept")),
          Effect.exit(adapter.respondToRequest(session.threadId, requestId, "decline")),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(responses.filter(Exit.isSuccess).length, 1);
      assert.equal(responses.filter(Exit.isFailure).length, 1);

      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (resolvedEvent._tag !== "Some" || resolvedEvent.value.type !== "request.resolved") {
        assert.fail("Expected request.resolved event");
        return;
      }
      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal(
        (permissionResult as PermissionResult).behavior,
        resolvedEvent.value.payload.decision === "accept" ? "allow" : "deny",
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
