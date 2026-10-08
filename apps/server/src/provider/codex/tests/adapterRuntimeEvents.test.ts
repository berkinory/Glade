import assert from "node:assert/strict";
import { ApprovalRequestId, ProviderItemId, TurnId } from "@glade/contracts/core/baseSchemas";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  FakeCodexManager,
  codexEvent,
  eventOfType,
  makeCodexAdapterTestLayer,
  mapCodexEvent,
  mapCodexEvents,
} from "./codexAdapter.testSupport.ts";

const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asItemId = (value: string): ProviderItemId => ProviderItemId.makeUnsafe(value);

const manager = new FakeCodexManager();
const mapEvent = <T extends Parameters<typeof eventOfType>[1]>(
  type: T,
  { id, ...event }: Parameters<typeof codexEvent>[1] & { readonly id: string },
) => mapCodexEvent(manager, type, codexEvent(id, event));
const mapEvents = (count: number, ...events: ReadonlyArray<ReturnType<typeof codexEvent>>) =>
  mapCodexEvents(manager, count, ...events);

it.layer(makeCodexAdapterTestLayer(manager))("CodexAdapterLive runtime events", (it) => {
  it.effect(
    "retains native subagent activity identities and terminal state for materialization",
    () =>
      Effect.gen(function* () {
        const kinds = ["started", "interacted", "interrupted", "completed"];
        const events = yield* mapEvents(
          kinds.length,
          ...kinds.map((kind) =>
            codexEvent(`evt-subagent-${kind}`, {
              kind: "notification",
              method: "item/completed",
              turnId: asTurnId("turn-parent"),
              payload: {
                item: {
                  type: "subAgentActivity",
                  id: `activity-${kind}`,
                  kind,
                  agentThreadId: "native-child",
                  agentPath: "/root/sol_deneme",
                },
              },
            }),
          ),
        );
        assert.deepEqual(
          events.map((event) => {
            const completed = eventOfType(event, "item.completed");
            assert.equal(completed.payload.itemType, "collab_agent_tool_call");
            const data = completed.payload.data as {
              item: {
                receiverThreadIds: string[];
                agentsStates: Record<string, { status: string }>;
              };
            };
            assert.deepEqual(data.item.receiverThreadIds, ["native-child"]);
            return data.item.agentsStates["native-child"]?.status;
          }),
          ["running", undefined, "interrupted", "completed"],
        );
      }),
  );

  it.effect("maps session/started to a canonical session.started runtime event", () =>
    Effect.gen(function* () {
      const started = yield* mapEvent("session.started", {
        id: "evt-session-started",
        kind: "session",
        method: "session/started",
        message: "Codex session ready for thread native-thread-1",
      });
      assert.equal(started.payload.message, "Codex session ready for thread native-thread-1");
    }),
  );

  it.effect("preserves failed commandExecution status from canonical completed items", () =>
    Effect.gen(function* () {
      const completed = yield* mapEvent("item.completed", {
        id: "evt-command-failed",
        kind: "notification",
        method: "item/completed",
        turnId: asTurnId("turn-1"),
        itemId: asItemId("command_1"),
        payload: {
          item: {
            type: "commandExecution",
            id: "command_1",
            command: "bun run test --runInBand",
            cwd: "/repo",
            status: "failed",
            commandActions: [],
            aggregatedOutput: "Unknown option --runInBand",
            exitCode: 1,
            durationMs: 42,
          },
        },
      });
      assert.equal(completed.payload.itemType, "command_execution");
      assert.equal(completed.payload.status, "failed");
      assert.equal(completed.payload.title, "Ran command");
      assert.equal(completed.payload.detail, "bun run test --runInBand");
    }),
  );

  it.effect("preserves Codex MCP and dynamic tool identity in lifecycle titles", () =>
    Effect.gen(function* () {
      const [mcp, dynamic] = yield* mapEvents(
        2,
        codexEvent("evt-mcp-start", {
          kind: "notification",
          method: "item/started",
          turnId: asTurnId("turn-1"),
          itemId: asItemId("mcp_1"),
          payload: {
            item: {
              type: "mcpToolCall",
              id: "mcp_1",
              server: "computer-use",
              tool: "get_app_state",
              arguments: { app: "com.apple.Safari" },
              status: "inProgress",
              appContext: {
                connectorId: "computer-use",
                actionName: "Read the screen",
                appName: "Safari",
              },
            },
          },
        }),
        codexEvent("evt-dynamic-start", {
          kind: "notification",
          method: "item/started",
          turnId: asTurnId("turn-1"),
          itemId: asItemId("dynamic_1"),
          payload: {
            item: {
              type: "dynamicToolCall",
              id: "dynamic_1",
              tool: "read_workspace_file",
              arguments: {},
              status: "inProgress",
            },
          },
        }),
      );
      assert.equal(eventOfType(mcp, "item.started").payload.title, "Read the screen in Safari");
      assert.equal(eventOfType(dynamic, "item.started").payload.title, "read_workspace_file");
    }),
  );

  it.effect("preserves async questions without emitting a blocking request", () =>
    Effect.gen(function* () {
      const completed = yield* mapEvent("item.completed", {
        id: "evt-msg-complete",
        kind: "notification",
        method: "item/completed",
        turnId: asTurnId("turn-1"),
        itemId: asItemId("msg_1"),
        payload: {
          item: {
            type: "agentMessage",
            id: "msg_1",
            delivery: "async",
            questions: [
              { title: "Which action?", options: ["Click", "Scroll"] },
              { title: "Anything else?", options: null },
            ],
          },
        },
      });
      assert.equal(completed.itemId, "msg_1");
      assert.equal(completed.turnId, "turn-1");
      assert.equal(completed.payload.itemType, "assistant_message");
      assert.deepStrictEqual(completed.payload.asyncQuestions, [
        { title: "Which action?", options: ["Click", "Scroll"] },
        { title: "Anything else?" },
      ]);
    }),
  );

  it.effect("keeps inspected images out of generated output artifacts", () =>
    Effect.gen(function* () {
      const payload = {
        item: { type: "imageView", id: "view_1", path: "/attachments/objects/upload.png" },
      };
      const completed = yield* mapEvent("item.completed", {
        id: "evt-image-view",
        kind: "notification",
        method: "item/completed",
        turnId: asTurnId("turn-1"),
        itemId: asItemId("view_1"),
        payload,
      });
      assert.equal(completed.payload.itemType, "image_view");
      assert.equal(completed.payload.title, "Image view");
      assert.deepStrictEqual(completed.payload.data, payload);
    }),
  );

  it.effect("maps completed generated-image items to structured image artifacts", () =>
    Effect.gen(function* () {
      const completed = yield* mapEvent("item.completed", {
        id: "evt-image-complete",
        kind: "notification",
        method: "item/completed",
        providerThreadId: "provider-thread-1",
        turnId: asTurnId("turn-1"),
        itemId: asItemId("img_call_1"),
        payload: {
          item: {
            type: "imageGeneration",
            id: "img_call_1",
            savedPath: "/tmp/provider-thread-1/img_call_1.png",
            result: "large-inline-base64",
          },
        },
      });
      assert.equal(completed.payload.itemType, "image_generation");
      assert.equal(completed.payload.title, "Generated image");
      assert.deepStrictEqual(completed.payload.data, {
        kind: "codex.generated_image",
        path: "/tmp/provider-thread-1/img_call_1.png",
        callId: "img_call_1",
      });
      const rawPayload = completed.raw?.payload as {
        item?: { result?: string; result_elided_for_relay?: boolean };
      };
      assert.equal(rawPayload.item?.result, undefined);
      assert.equal(rawPayload.item?.result_elided_for_relay, true);
    }),
  );

  it.effect("maps exited review items to assistant completion events with review text", () =>
    Effect.gen(function* () {
      const completed = yield* mapEvent("item.completed", {
        id: "evt-review-complete",
        kind: "notification",
        method: "item/completed",
        turnId: asTurnId("turn-review"),
        payload: {
          item: { type: "exitedReviewMode", id: "review_1", review: "Working tree is clean." },
        },
      });
      assert.equal(completed.turnId, "turn-review");
      assert.equal(completed.payload.itemType, "assistant_message");
      assert.equal(completed.payload.detail, "Working tree is clean.");
    }),
  );

  it.effect("maps session/closed lifecycle events to canonical session.exited runtime events", () =>
    Effect.gen(function* () {
      const exited = yield* mapEvent("session.exited", {
        id: "evt-session-closed",
        kind: "session",
        method: "session/closed",
        message: "Session stopped",
      });
      assert.equal(exited.threadId, "thread-1");
      assert.equal(exited.payload.reason, "Session stopped");
    }),
  );

  it.effect("maps retryable Codex error notifications to runtime.warning", () =>
    Effect.gen(function* () {
      const warning = yield* mapEvent("runtime.warning", {
        id: "evt-retryable-error",
        kind: "notification",
        method: "error",
        turnId: asTurnId("turn-1"),
        payload: {
          error: { message: "Reconnecting... 2/5", codexErrorInfo: "serverOverloaded" },
          threadId: "thread-1",
          turnId: "turn-1",
          willRetry: true,
        },
      });
      assert.equal(warning.turnId, "turn-1");
      assert.equal(warning.payload.message, "Reconnecting... 2/5");
    }),
  );

  it.effect("maps permission-profile approval requests to the canonical permission kind", () =>
    Effect.gen(function* () {
      const payload = {
        reason: "Needs network access",
        permissions: { network: { enabled: true } },
      };
      const opened = yield* mapEvent("request.opened", {
        id: "evt-permissions-request",
        kind: "request",
        method: "item/permissions/requestApproval",
        requestId: ApprovalRequestId.makeUnsafe("req-permissions-1"),
        requestKind: "permissions",
        payload,
      });
      assert.equal(opened.payload.requestType, "permissions_approval");
      assert.equal(opened.payload.detail, "Needs network access");
      assert.deepEqual(opened.payload.args, payload);
    }),
  );

  it.effect("maps MCP tool-call approval elicitations to tool approvals", () =>
    Effect.gen(function* () {
      const payload = {
        message: "Allow the tool call?",
        _meta: {
          tool_name: "computer_launch_app",
          tool_params_display: [{ name: "app", value: "kcalc" }],
        },
      };
      const opened = yield* mapEvent("request.opened", {
        id: "evt-mcp-tool-approval",
        kind: "request",
        method: "mcpServer/elicitation/request",
        requestId: ApprovalRequestId.makeUnsafe("req-mcp-tool-1"),
        requestKind: "tool",
        payload,
      });
      assert.equal(opened.payload.requestType, "tool_approval");
      assert.equal(opened.payload.detail, "Allow the tool call?");
      assert.deepEqual(opened.payload.args, payload);
    }),
  );

  it.effect("maps windowsSandbox/setupCompleted to session state and warning on failure", () =>
    Effect.gen(function* () {
      const [state, warning] = yield* mapEvents(
        2,
        codexEvent("evt-windows-sandbox-failed", {
          kind: "notification",
          method: "windowsSandbox/setupCompleted",
          message: "Sandbox setup failed",
          payload: { success: false, detail: "unsupported environment" },
        }),
      );
      assert.notEqual(state?.eventId, warning?.eventId);
      const changed = eventOfType(state, "session.state.changed");
      assert.equal(changed.payload.state, "error");
      assert.equal(changed.payload.reason, "Sandbox setup failed");
      assert.equal(eventOfType(warning, "runtime.warning").payload.message, "Sandbox setup failed");
    }),
  );

  it.effect(
    "maps requestUserInput requests and answered notifications to canonical user-input events",
    () =>
      Effect.gen(function* () {
        const answered = (id: string, requestId: string, answers: Record<string, unknown>) =>
          codexEvent(id, {
            kind: "notification",
            lifecycleGeneration: "generation-request-a",
            method: "item/tool/requestUserInput/answered",
            requestId: ApprovalRequestId.makeUnsafe(requestId),
            payload: { answers },
          });
        const [requested, resolved, resolvedEmpty] = yield* mapEvents(
          3,
          codexEvent("evt-user-input-requested", {
            kind: "request",
            lifecycleGeneration: "generation-request-a",
            method: "item/tool/requestUserInput",
            requestId: ApprovalRequestId.makeUnsafe("req-user-input-1"),
            payload: {
              questions: [
                {
                  id: "sandbox_mode",
                  header: "Sandbox",
                  question: "Which mode should be used?",
                  options: [
                    { label: "workspace-write", description: "Allow workspace writes only" },
                  ],
                },
              ],
            },
          }),
          answered("evt-user-input-resolved", "req-user-input-1", {
            sandbox_mode: { answers: ["workspace-write"] },
          }),
          answered("evt-user-input-empty", "req-user-input-2", { scope: [] }),
        );
        const opened = eventOfType(requested, "user-input.requested");
        assert.equal(opened.requestId, "req-user-input-1");
        assert.equal(opened.lifecycleGeneration, "generation-request-a");
        assert.equal(opened.payload.questions[0]?.id, "sandbox_mode");

        const settled = eventOfType(resolved, "user-input.resolved");
        assert.equal(settled.requestId, "req-user-input-1");
        assert.equal(settled.lifecycleGeneration, "generation-request-a");
        assert.deepEqual(settled.payload.answers, { sandbox_mode: "workspace-write" });
        assert.deepEqual(eventOfType(resolvedEmpty, "user-input.resolved").payload.answers, {
          scope: [],
        });
      }),
  );

  it.effect("prefers manager-assigned turn ids for Codex task events", () =>
    Effect.gen(function* () {
      const started = yield* mapEvent("task.started", {
        id: "evt-codex-task-started-parent-turn",
        kind: "notification",
        turnId: asTurnId("turn-parent"),
        method: "codex/event/task_started",
        payload: {
          id: "turn-child",
          msg: { type: "task_started", turn_id: "turn-child", collaboration_mode_kind: "default" },
          conversationId: "child-provider-thread",
        },
      });
      assert.equal(started.turnId, "turn-parent");
      assert.equal(started.providerRefs?.providerTurnId, "turn-parent");
      assert.equal(started.payload.taskId, "turn-child");
    }),
  );

  it.effect("unwraps Codex token usage payloads for context window events", () =>
    Effect.gen(function* () {
      const updated = yield* mapEvent("thread.token-usage.updated", {
        id: "evt-codex-thread-token-usage-updated",
        kind: "notification",
        turnId: asTurnId("turn-1"),
        method: "thread/tokenUsage/updated",
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              inputTokens: 11_833,
              cachedInputTokens: 3456,
              cacheWriteInputTokens: 500,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 11_839,
            },
            last: {
              inputTokens: 120,
              cachedInputTokens: 0,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 126,
            },
            modelContextWindow: 258_400,
          },
        },
      });
      assert.deepEqual(updated.payload.usage, {
        usedTokens: 126,
        cumulativeUsage: {
          inputTokens: 11_833,
          outputTokens: 6,
          cachedInputTokens: 3456,
          cacheCreationInputTokens: 500,
        },
        totalProcessedTokens: 11_839,
        maxTokens: 258_400,
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 6,
        reasoningOutputTokens: 0,
        lastUsedTokens: 126,
        lastInputTokens: 120,
        lastCachedInputTokens: 0,
        lastOutputTokens: 6,
        lastReasoningOutputTokens: 0,
        compactsAutomatically: true,
      });
    }),
  );

  it.effect("maps thread/compacting notifications to context compaction progress events", () =>
    Effect.gen(function* () {
      const updated = yield* mapEvent("item.updated", {
        id: "evt-codex-thread-compacting",
        kind: "notification",
        method: "thread/compacting",
        message: "Compacting context",
        payload: { threadId: "thread-1", state: "compacting" },
      });
      assert.equal(updated.payload.itemType, "context_compaction");
      assert.equal(updated.payload.detail, "Compacting context");
      assert.equal(updated.payload.status, "inProgress");
    }),
  );

  it.effect("maps Codex hook notifications to bounded canonical lifecycle events", () =>
    Effect.gen(function* () {
      const commonRun = {
        id: "hook-run-1",
        eventName: "preToolUse",
        executionMode: "sync",
        handlerType: "command",
        scope: "turn",
        source: "user",
        sourcePath: "/Users/example/.codex/hooks.json",
        displayOrder: 0,
        startedAt: 100,
      };
      const runningRun = {
        ...commonRun,
        status: "running",
        statusMessage: null,
        completedAt: null,
        durationMs: null,
        entries: [],
      };
      const hook = (id: string, method: string, run: Record<string, unknown>) =>
        codexEvent(id, {
          kind: "notification",
          turnId: asTurnId("turn-1"),
          method,
          payload: { threadId: "thread-1", turnId: "turn-1", run },
        });
      const [startedEvent, completedEvent] = yield* mapEvents(
        2,
        hook("evt-codex-hook-started", "hook/started", runningRun),
        hook("evt-codex-hook-completed", "hook/completed", {
          ...commonRun,
          status: "blocked",
          statusMessage: "api_key=private-hook-secret blocked this action",
          completedAt: 112,
          durationMs: 12,
          entries: [{ kind: "error", text: "Authorization: Bearer private-hook-token" }],
        }),
      );
      const started = eventOfType(startedEvent, "hook.started");
      assert.deepEqual(started.payload, {
        hookId: "hook-run-1",
        hookName: "/Users/example/.codex/hooks.json",
        hookEvent: "preToolUse",
        data: runningRun,
      });
      assert.deepEqual(started.raw?.payload, { gladeSanitized: true });

      const completed = eventOfType(completedEvent, "hook.completed");
      assert.equal(completed.payload.outcome, "cancelled");
      assert.equal(completed.payload.status, "blocked");
      assert.equal(completed.payload.durationMs, 12);
      const serialized = JSON.stringify(completed);
      assert.equal(serialized.includes("private-hook-secret"), false);
      assert.equal(serialized.includes("private-hook-token"), false);
      assert.equal(serialized.includes("[REDACTED]"), true);
      assert.deepEqual(completed.raw?.payload, { gladeSanitized: true });
    }),
  );

  it.effect(
    "surfaces previously-unmapped native events with bounded redacted diagnostics instead of raw payloads",
    () =>
      Effect.gen(function* () {
        const unmapped = yield* mapEvent("event.unmapped", {
          id: "evt-unmapped-agent-message-completed",
          kind: "notification",
          method: "item/agentMessage/completed",
          turnId: asTurnId("turn-1"),
          itemId: asItemId("agent_message_9"),
          payload: {
            apiKey: "must-not-reach-the-runtime-journal",
            note: "Authorization: Bearer private-token",
            msg: {
              type: "item/agentMessage/completed",
              item_id: "agent_message_9",
              summary: "Finished the refactor",
            },
            output: "x".repeat(64_000),
          },
        });
        assert.equal(unmapped.payload.nativeType, "item/agentMessage/completed");
        assert.equal(unmapped.payload.detail, "Finished the refactor");
        const serialized = JSON.stringify(unmapped);
        assert.equal(serialized.includes("must-not-reach-the-runtime-journal"), false);
        assert.equal(serialized.includes("private-token"), false);
        assert.ok(serialized.length < 17_000);
        assert.deepEqual(unmapped.raw?.payload, { gladeSanitized: true });
        assert.equal(unmapped.itemId, "agent_message_9");
        assert.equal(unmapped.providerRefs?.providerItemId, "agent_message_9");
      }),
  );
});
