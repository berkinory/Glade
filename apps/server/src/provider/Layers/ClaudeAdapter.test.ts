import { Schema } from "effect";
import { makeNativeToolCallRegistry } from "../../agentGateway/nativeToolCalls.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  Options as ClaudeQueryOptions,
  HookInput,
  ModelInfo,
  PermissionMode,
  PermissionResult,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { assert, describe, it } from "@effect/vitest";

import { Effect, Exit, Fiber, Layer, Random, Stream } from "effect";

import { afterEach, beforeEach, vi } from "vitest";

import { attachmentRelativePath } from "../../attachments/attachmentStore.ts";
import { GLADE_HARNESS_POLICY_MARKER } from "../../agentGateway/harnessPolicy.ts";
import {
  AgentGatewayCredentials,
  type AgentGatewayCredentialsShape,
} from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { ServerConfig } from "../../server/config.ts";
import { MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION } from "../claude/claudeCliVersion.ts";

import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../core/Errors.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import {
  buildEmbeddedClaudeSystemPromptAppend,
  makeClaudeAdapterLive as makeClaudeAdapterLiveBase,
  type ClaudeAdapterLiveOptions,
  type ClaudeOwnedProcess,
} from "./ClaudeAdapter.ts";

vi.mock("effect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect")>();
  return { ...actual, Queue: { ...actual.Queue } };
});

function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  return makeClaudeAdapterLiveBase({
    readClaudeCliVersion: async () => MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION,
    ...options,
  });
}

class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<{
    readonly resolve: (value: IteratorResult<SDKMessage>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  private done = false;
  private failure: unknown | undefined;

  public readonly interruptCalls: Array<void> = [];
  public readonly stopTaskCalls: Array<string> = [];
  public readonly backgroundTasksCalls: Array<string | undefined> = [];
  public readonly setModelCalls: Array<string | undefined> = [];
  public readonly setPermissionModeCalls: Array<string> = [];
  public readonly setMaxThinkingTokensCalls: Array<number | null> = [];
  public readonly applyFlagSettingsCalls: Array<Record<string, unknown>> = [];
  public getContextUsageCalls = 0;
  public getContextUsageDetails: Array<"summary" | "full" | undefined> = [];
  public iteratorNextCalls = 0;
  private contextUsageResponse: SDKControlGetContextUsageResponse | undefined;
  private contextUsageNeverResolves = false;
  public closeCalls = 0;
  public supportedCommandList: Array<{ name: string; description: string; argumentHint: string }> =
    [];
  public supportedCommandsNeverResolves = false;

  emit(message: SDKMessage): void {
    if (this.done) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  fail(cause: unknown): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.failure = cause;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(cause);
    }
  }

  finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.failure = undefined;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  readonly interrupt = async (): Promise<void> => {
    this.interruptCalls.push(undefined);
  };

  readonly stopTask = async (taskId: string): Promise<void> => {
    this.stopTaskCalls.push(taskId);
  };

  readonly backgroundTasks = async (toolUseId?: string): Promise<boolean> => {
    this.backgroundTasksCalls.push(toolUseId);
    return true;
  };

  readonly setModel = async (model?: string): Promise<void> => {
    this.setModelCalls.push(model);
  };

  readonly setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    this.setPermissionModeCalls.push(mode);
  };

  readonly setMaxThinkingTokens = async (maxThinkingTokens: number | null): Promise<void> => {
    this.setMaxThinkingTokensCalls.push(maxThinkingTokens);
  };

  readonly applyFlagSettings = async (settings: Record<string, unknown>): Promise<void> => {
    this.applyFlagSettingsCalls.push(settings);
  };

  setContextUsageResponse(response: SDKControlGetContextUsageResponse): void {
    this.contextUsageResponse = response;
  }

  setContextUsageNeverResolves(): void {
    this.contextUsageNeverResolves = true;
  }

  readonly getContextUsage = async (options?: {
    readonly detail?: "summary" | "full";
  }): Promise<SDKControlGetContextUsageResponse> => {
    this.getContextUsageCalls += 1;
    this.getContextUsageDetails.push(options?.detail);
    if (this.contextUsageNeverResolves) {
      return new Promise<SDKControlGetContextUsageResponse>(() => {});
    }
    if (!this.contextUsageResponse) {
      throw new Error("Context usage unavailable in this test.");
    }
    return this.contextUsageResponse;
  };

  readonly supportedCommands = async (): Promise<
    Array<{ name: string; description: string; argumentHint: string }>
  > => {
    if (this.supportedCommandsNeverResolves) return new Promise(() => {});
    return this.supportedCommandList;
  };

  readonly supportedModels = async (): Promise<Array<ModelInfo>> => {
    return [
      {
        value: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        description: "Default supported test model",
        supportsEffort: true,
        supportsAdaptiveThinking: true,
        supportsFastMode: false,
        supportsAutoMode: true,
      },
    ];
  };

  readonly supportedAgents = async (): Promise<[]> => {
    return [];
  };

  readonly close = (): void => {
    this.closeCalls += 1;
    this.finish();
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        this.iteratorNextCalls += 1;
        if (this.queue.length > 0) {
          const value = this.queue.shift();
          if (value) {
            return Promise.resolve({
              done: false,
              value,
            });
          }
        }
        if (this.failure !== undefined) {
          const failure = this.failure;
          this.failure = undefined;
          return Promise.reject(failure);
        }
        if (this.done) {
          return Promise.resolve({
            done: true,
            value: undefined,
          });
        }
        return new Promise((resolve, reject) => {
          this.waiters.push({
            resolve,
            reject,
          });
        });
      },
    };
  }
}

function makeHarness(config?: {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: ClaudeAdapterLiveOptions["nativeEventLogger"];
  readonly cwd?: string;
  readonly baseDir?: string;
  readonly workflowRuntimePollIntervalMs?: number;
  readonly onCreate?: (options: ClaudeQueryOptions) => void;
}) {
  const query = new FakeClaudeQuery();
  let createInput:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }
    | undefined;

  const adapterOptions: ClaudeAdapterLiveOptions = {
    createQuery: (input) => {
      createInput = input;
      config?.onCreate?.(input.options);
      return query;
    },
    ...(config?.nativeEventLogger
      ? {
          nativeEventLogger: config.nativeEventLogger,
        }
      : {}),
    ...(config?.nativeEventLogPath
      ? {
          nativeEventLogPath: config.nativeEventLogPath,
        }
      : {}),
    ...(config?.workflowRuntimePollIntervalMs !== undefined
      ? {
          workflowRuntimePollIntervalMs: config.workflowRuntimePollIntervalMs,
        }
      : {}),
  };

  return {
    layer: makeClaudeAdapterLive(adapterOptions).pipe(
      Layer.provideMerge(
        ServerConfig.layerTest(
          config?.cwd ?? "/tmp/claude-adapter-test",
          config?.baseDir ?? "/tmp",
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    ),
    query,
    getLastCreateQueryInput: () => createInput,
  };
}

function makeMultiQueryHarness(config?: {
  readonly nativeHistory?: Pick<
    ClaudeAdapterLiveOptions,
    "readNativeSessionMessages" | "readNativeMessageParent" | "forkNativeSession"
  >;
  readonly failCreateAt?: number;
  readonly gatewayCredentials?: AgentGatewayCredentialsShape;
  readonly onCreate?: (options: ClaudeQueryOptions) => void;
}) {
  const queries: Array<FakeClaudeQuery> = [];
  const createInputs: Array<{
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }> = [];
  let layer = makeClaudeAdapterLive({
    ...config?.nativeHistory,
    createQuery: (input) => {
      if (queries.length === config?.failCreateAt) {
        throw new Error("simulated Claude spawn failure");
      }
      const query = new FakeClaudeQuery();
      queries.push(query);
      createInputs.push(input);
      config?.onCreate?.(input.options);
      return query;
    },
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
    Layer.provideMerge(NodeServices.layer),
  );
  if (config?.gatewayCredentials) {
    layer = layer.pipe(
      Layer.provideMerge(Layer.succeed(AgentGatewayCredentials, config.gatewayCredentials)),
    );
  }

  return { layer, queries, createInputs };
}

function makeGatewayCredentialsHarness(options?: {
  readonly cancelSessionTurnRequests?: (token: string, turnId: string) => Promise<void>;
}) {
  let sequence = 0;
  const revokedTokens: string[] = [];
  const leasedCapabilities: Array<readonly string[]> = [];
  const cancelledTurns: Array<{ readonly token: string; readonly turnId: string }> = [];
  const nativeToolCalls = makeNativeToolCallRegistry();
  const credentials = {
    nativeToolCalls,
    mcpEndpointUrl: "http://127.0.0.1:48123/mcp",
    setListeningPort: () => undefined,
    issueSessionToken: () => `gateway-token-${++sequence}`,
    verifySessionToken: () => null,
    verifySession: () => null,
    bindWriteAuthority: () => null,
    verifyWriteAuthority: () => false,
    registerInFlightRequest: () => () => undefined,
    cancelInFlightRequests: () => ({ count: 0, settled: Promise.resolve() }),
    cancelSessionTurnRequests: (token, turnId) => {
      nativeToolCalls.retire(token, turnId);
      cancelledTurns.push({ token, turnId });
      return options?.cancelSessionTurnRequests?.(token, turnId) ?? Promise.resolve();
    },
    retireSessionTurn: (token, turnId) => {
      nativeToolCalls.retire(token, turnId);
      cancelledTurns.push({ token, turnId });
      return options?.cancelSessionTurnRequests?.(token, turnId) ?? Promise.resolve();
    },
    revokeSessionToken: (token: string) => {
      nativeToolCalls.revoke(token);
      revokedTokens.push(token);
    },
    connectionForThread: (_threadId, _provider, leaseOptions) => {
      leasedCapabilities.push(leaseOptions?.additionalCapabilities ?? []);
      return {
        url: "http://127.0.0.1:48123/mcp",
        bearerToken: `gateway-token-${++sequence}`,
      };
    },
  } satisfies AgentGatewayCredentialsShape;
  return { cancelledTurns, credentials, leasedCapabilities, revokedTokens };
}

function makeDeterministicRandomService(seed = 0x1234_5678): {
  nextIntUnsafe: () => number;
  nextDoubleUnsafe: () => number;
} {
  let state = seed >>> 0;
  const nextIntUnsafe = (): number => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state;
  };

  return {
    nextIntUnsafe,
    nextDoubleUnsafe: () => nextIntUnsafe() / 0x1_0000_0000,
  };
}

function emitAssistantUsage(
  query: FakeClaudeQuery,
  sessionId: string,
  uuid: string,
  text: string,
  usage: Record<string, number>,
  messageId = uuid,
): void {
  query.emit({
    type: "assistant",
    session_id: sessionId,
    uuid,
    parent_tool_use_id: null,
    message: {
      id: messageId,
      content: [{ type: "text", text }],
      usage,
    },
  } as unknown as SDKMessage);
}

function emitSuccessResult(
  query: FakeClaudeQuery,
  sessionId: string,
  uuid: string,
  usage: Record<string, number>,
): void {
  query.emit({
    type: "result",
    subtype: "success",
    is_error: false,
    errors: [],
    session_id: sessionId,
    uuid,
    usage,
  } as unknown as SDKMessage);
}

function assertTokenUsageEvent(
  event: ProviderRuntimeEvent | undefined,
): asserts event is Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }> {
  assert.equal(event?.type, "thread.token-usage.updated");
}

async function readFirstPromptText(
  input:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
      }
    | undefined,
): Promise<string | undefined> {
  const iterator = input?.prompt[Symbol.asyncIterator]();
  if (!iterator) {
    return undefined;
  }
  const next = await iterator.next();
  if (next.done) {
    return undefined;
  }
  const content = next.value.message.content[0];
  if (!content || typeof content === "string" || content.type !== "text") {
    return undefined;
  }
  return content.text;
}

async function readFirstPromptMessage(
  input:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
      }
    | undefined,
): Promise<SDKUserMessage | undefined> {
  const iterator = input?.prompt[Symbol.asyncIterator]();
  if (!iterator) {
    return undefined;
  }
  const next = await iterator.next();
  if (next.done) {
    return undefined;
  }
  return next.value;
}

const THREAD_ID = ThreadId.makeUnsafe("thread-claude-1");
const RESUME_THREAD_ID = ThreadId.makeUnsafe("thread-claude-resume");

describe("Claude Glade harness policy", () => {
  it("advertises scoped MCP additively when credentials are available", () => {
    const text = buildEmbeddedClaudeSystemPromptAppend(true);
    assert.include(text, GLADE_HARNESS_POLICY_MARKER);
    assert.include(text, "Final responses must restate every needed scope");
    assert.include(text, "include all decision context");
    assert.include(text, "Use the glade_* tools");
    assert.notInclude(text, "Glade MCP control is unavailable");
  });

  it("stays truthful when scoped MCP credentials are absent", () => {
    const text = buildEmbeddedClaudeSystemPromptAppend(false);
    assert.include(text, GLADE_HARNESS_POLICY_MARKER);
    assert.include(text, "Final responses must restate every needed scope");
    assert.include(text, "include all decision context");
    assert.include(text, "Glade MCP control is unavailable");
  });
});

describe("ClaudeAdapterLive", () => {
  it.effect("derives bypass permission mode from full-access runtime policy", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.equal(createInput?.options.permissionMode, "bypassPermissions");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rejects Auto on an unsupported selected Claude binary before session startup", () => {
    const query = new FakeClaudeQuery();
    let createQueryCalls = 0;
    const layer = makeClaudeAdapterLiveBase({
      readClaudeCliVersion: async ({ binaryPath }) => {
        assert.equal(binaryPath, "/custom/bin/claude");
        return "2.1.110";
      },
      createQuery: () => {
        createQueryCalls += 1;
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* Effect.exit(
        adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "auto",
          providerOptions: {
            claudeAgent: {
              binaryPath: "/custom/bin/claude",
            },
          },
        }),
      );

      assert.ok(Exit.isFailure(result));
      assert.equal(createQueryCalls, 0);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("loads Claude filesystem settings sources for SDK sessions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.equal(createInput?.options.permissionMode, undefined);
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, undefined);
      const systemPrompt = createInput?.options.systemPrompt;
      if (
        systemPrompt === undefined ||
        typeof systemPrompt === "string" ||
        Array.isArray(systemPrompt) ||
        systemPrompt.type !== "preset"
      ) {
        return assert.fail("Expected Claude preset system prompt.");
      }
      assert.equal(systemPrompt.preset, "claude_code");
      assert.equal(systemPrompt.excludeDynamicSections, true);
      assert.include(systemPrompt.append ?? "", "When spawning subagents");
      assert.include(systemPrompt.append ?? "", "worker-<tier>");
      assert.include(systemPrompt.append ?? "", GLADE_HARNESS_POLICY_MARKER);
      assert.include(systemPrompt.append ?? "", "Glade is the host and harness");

      assert.include(systemPrompt.append ?? "", "Glade MCP control is unavailable");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("steers a live turn through the prompt queue without opening a new turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.started" || event.type === "turn.steered"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Start the work",
        attachments: [],
      });

      const steered = yield* adapter.steerTurn({
        threadId: session.threadId,
        input: "Actually, focus on the tests",
        attachments: [],
      });

      assert.equal(String(steered.turnId), String(turn.turnId));

      const createInput = harness.getLastCreateQueryInput();
      const iterator = createInput?.prompt[Symbol.asyncIterator]();
      const firstPrompt = yield* Effect.promise(() => iterator!.next());
      const secondPrompt = yield* Effect.promise(() => iterator!.next());
      const promptText = (message: IteratorResult<SDKUserMessage>): string | undefined => {
        if (message.done) {
          return undefined;
        }
        const content = message.value.message.content[0];
        return typeof content === "string" || content?.type !== "text" ? undefined : content.text;
      };
      assert.equal(promptText(firstPrompt), "Start the work");
      assert.equal(promptText(secondPrompt), "Actually, focus on the tests");

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        ["turn.started", "turn.steered"],
      );
      const steeredEvent = runtimeEvents[1];
      assert.equal(steeredEvent?.type, "turn.steered");
      if (steeredEvent?.type === "turn.steered") {
        assert.equal(String(steeredEvent.turnId), String(turn.turnId));
        assert.equal(steeredEvent.payload.message, "Actually, focus on the tests");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("embeds image attachments in Claude user messages", () => {
    const baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-attachments-"));
    const harness = makeHarness({
      cwd: "/tmp/project-claude-attachments",
      baseDir,
    });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() =>
          rmSync(baseDir, {
            recursive: true,
            force: true,
          }),
        ),
      );

      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;

      const attachment = {
        type: "image" as const,
        id: "thread-claude-attachment-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const attachmentPath = path.join(attachmentsDir, attachmentRelativePath(attachment));
      mkdirSync(path.dirname(attachmentPath), { recursive: true });
      writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "What's in this image?",
        attachments: [attachment],
      });

      const createInput = harness.getLastCreateQueryInput();
      const promptMessage = yield* Effect.promise(() => readFirstPromptMessage(createInput));
      assert.isDefined(promptMessage);
      assert.deepEqual(promptMessage?.message.content, [
        {
          type: "text",
          text: "What's in this image?",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "AQIDBA==",
          },
        },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("maps Claude stream/runtime messages to canonical provider runtime events", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 10).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-5",
        },
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      const commandWhoseTruncationEndsInWhitespace = `${"x".repeat(399)} \nignored`;

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-0",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "Hi",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-3",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: {
              command: commandWhoseTruncationEndsInWhitespace,
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-4",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-1",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-1",
          content: [{ type: "text", text: "Hi" }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-1",
        uuid: "result-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.completed",
          "item.started",
          "item.completed",
          "turn.completed",
        ],
      );

      const turnStarted = runtimeEvents[3];
      assert.equal(turnStarted?.type, "turn.started");
      if (turnStarted?.type === "turn.started") {
        assert.equal(String(turnStarted.turnId), String(turn.turnId));
      }

      const deltaEvent = runtimeEvents.find((event) => event.type === "content.delta");
      assert.equal(deltaEvent?.type, "content.delta");
      if (deltaEvent?.type === "content.delta") {
        assert.equal(deltaEvent.payload.delta, "Hi");
        assert.equal(String(deltaEvent.turnId), String(turn.turnId));
        assert.deepEqual(deltaEvent.raw?.payload, {});
      }

      const toolStarted = runtimeEvents.find((event) => event.type === "item.started");
      assert.equal(toolStarted?.type, "item.started");
      if (toolStarted?.type === "item.started") {
        assert.equal(toolStarted.payload.itemType, "command_execution");
        assert.equal(toolStarted.payload.detail, `Bash: ${"x".repeat(399)}`);
      }

      const assistantCompletedIndex = runtimeEvents.findIndex(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      const toolStartedIndex = runtimeEvents.findIndex((event) => event.type === "item.started");
      assert.equal(
        assistantCompletedIndex >= 0 &&
          toolStartedIndex >= 0 &&
          assistantCompletedIndex < toolStartedIndex,
        true,
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "completed");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("maps Claude reasoning deltas, streamed tool inputs, and tool results", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 11).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-thinking",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "Let",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-grep-1",
            name: "Grep",
            input: {},
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-input-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: '{"pattern":"foo","path":"src"}',
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "user",
        session_id: "sdk-session-tool-streams",
        uuid: "user-tool-result",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-grep-1",
              content: "src/example.ts:1:foo",
            },
          ],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-tool-streams",
        uuid: "result-tool-streams",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.started",
          "item.updated",
          "item.updated",
          "item.completed",
          "turn.completed",
        ],
      );

      const reasoningDelta = runtimeEvents.find(
        (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
      );
      assert.equal(reasoningDelta?.type, "content.delta");
      if (reasoningDelta?.type === "content.delta") {
        assert.equal(reasoningDelta.payload.delta, "Let");
        assert.equal(String(reasoningDelta.turnId), String(turn.turnId));
      }

      const toolStarted = runtimeEvents.find((event) => event.type === "item.started");
      assert.equal(toolStarted?.type, "item.started");
      if (toolStarted?.type === "item.started") {
        assert.equal(toolStarted.payload.itemType, "dynamic_tool_call");
      }

      const toolInputUpdated = runtimeEvents.find(
        (event) =>
          event.type === "item.updated" &&
          (event.payload.data as { input?: { pattern?: string; path?: string } } | undefined)?.input
            ?.pattern === "foo",
      );
      assert.equal(toolInputUpdated?.type, "item.updated");
      if (toolInputUpdated?.type === "item.updated") {
        assert.deepEqual(toolInputUpdated.payload.data, {
          toolCallId: "tool-grep-1",
          callId: "tool-grep-1",
          toolName: "Grep",
          input: {
            pattern: "foo",
            path: "src",
          },
        });
      }

      const toolResultUpdated = runtimeEvents.find(
        (event) =>
          event.type === "item.updated" &&
          (event.payload.data as { result?: { tool_use_id?: string } } | undefined)?.result
            ?.tool_use_id === "tool-grep-1",
      );
      assert.equal(toolResultUpdated?.type, "item.updated");
      if (toolResultUpdated?.type === "item.updated") {
        assert.equal(
          (
            toolResultUpdated.payload.data as {
              result?: { content?: string };
            }
          ).result?.content,
          "src/example.ts:1:foo",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("routes subagent-tagged messages to a child provider thread", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "turn.completed" && event.providerRefs?.providerThreadId === undefined,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "delegate this",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-subagent",
        uuid: "stream-subagent-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-task-1",
            name: "Task",
            input: {
              description: "Review the database layer",
              prompt: "Audit the SQL changes",
              subagent_type: "code-reviewer",
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        subagent_type: "code-reviewer",
        description: "Review the database layer",
        session_id: "sdk-session-subagent",
        uuid: "task-started-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-subagent",
        uuid: "assistant-subagent-1",
        parent_tool_use_id: "tool-task-1",
        message: {
          id: "assistant-message-subagent-1",
          content: [{ type: "text", text: "Reviewing the migration now." }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-subagent",
        uuid: "assistant-subagent-block-2",
        parent_tool_use_id: "tool-task-1",
        message: {
          id: "assistant-message-subagent-1",
          content: [{ type: "text", text: "The migration looks correct." }],
          usage: { input_tokens: 10, output_tokens: 8 },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "tool_progress",
        tool_use_id: "tool-subagent-heartbeat-1",
        tool_name: "Grep",
        parent_tool_use_id: "tool-task-1",
        elapsed_time_seconds: 5,
        heartbeat: true,
        session_id: "sdk-session-subagent",
        uuid: "tool-progress-subagent-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        description: "Review the database layer",
        usage: { total_tokens: 123, tool_uses: 4, duration_ms: 987 },
        session_id: "sdk-session-subagent",
        uuid: "task-progress-subagent-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        tool_use_id: "tool-task-1",
        status: "completed",
        output_file: "/tmp/task-1-output.md",
        summary: "Reviewed the migration.",
        session_id: "sdk-session-subagent",
        uuid: "task-notification-1",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-subagent",
        uuid: "result-subagent-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const childEvents = runtimeEvents.filter(
        (event) => event.providerRefs?.providerThreadId === "tool-task-1",
      );
      assert.deepEqual(
        childEvents
          .filter((event) => event.type === "thread.token-usage.updated")
          .map((event) => event.payload.usage.totalProcessedTokens),
        [15, 18, undefined, 18],
      );
      assert.equal(
        childEvents.every((event) => event.providerRefs?.providerParentThreadId === THREAD_ID),
        true,
      );
      assert.equal(
        childEvents.some((event) => event.type === "turn.started"),
        true,
      );
      assert.equal(
        childEvents.some(
          (event) => event.type === "tool.progress" && event.payload.toolName === "Grep",
        ),
        true,
      );

      const collabStarted = runtimeEvents.find(
        (event) =>
          event.type === "item.started" && event.payload.itemType === "collab_agent_tool_call",
      );
      assert.equal(collabStarted?.type, "item.started");
      if (collabStarted?.type === "item.started") {
        const data = collabStarted.payload.data as Record<string, unknown>;
        assert.equal(data.receiverThreadId, "tool-task-1");
        assert.equal(data.agentType, "code-reviewer");
        assert.equal(data.nickname, "Review the database layer");
      }

      const textDeltas = runtimeEvents.filter(
        (event) =>
          event.type === "content.delta" && event.payload.delta.includes("Reviewing the migration"),
      );
      assert.equal(textDeltas.length > 0, true);
      assert.equal(
        textDeltas.every((event) => event.providerRefs?.providerThreadId === "tool-task-1"),
        true,
      );

      const usageEvents = runtimeEvents.filter(
        (event) => event.type === "thread.token-usage.updated",
      );
      assert.equal(usageEvents.length > 0, true);
      assert.equal(
        usageEvents.every((event) => event.providerRefs?.providerThreadId === "tool-task-1"),
        true,
      );
      const taskUsage = usageEvents.find(
        (event) =>
          event.type === "thread.token-usage.updated" && event.payload.usage.usedTokens === 123,
      );
      assert.equal(taskUsage?.type, "thread.token-usage.updated");

      const childTurnCompleted = childEvents.find((event) => event.type === "turn.completed");
      assert.equal(childTurnCompleted?.type, "turn.completed");
      if (childTurnCompleted?.type === "turn.completed") {
        assert.equal(childTurnCompleted.payload.state, "completed");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("stops a targeted subagent task instead of interrupting the whole turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "task.started"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      assert.equal(harness.getLastCreateQueryInput()?.options.forwardSubagentText, true);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-stop-1",
        tool_use_id: "tool-task-stop-1",
        subagent_type: "code-reviewer",
        description: "Long-running review",
        session_id: "sdk-session-stop",
        uuid: "task-started-stop-1",
      } as unknown as SDKMessage);
      yield* Fiber.join(runtimeEventsFiber);

      yield* adapter.interruptTurn(session.threadId, undefined, "tool-task-stop-1");
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1"]);
      assert.equal(harness.query.interruptCalls.length, 0);
      assert.equal(harness.query.backgroundTasksCalls.length, 0);

      yield* adapter.interruptTurn(session.threadId, undefined, "tool-task-pending");
      assert.equal(harness.query.backgroundTasksCalls.length, 0);
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1"]);

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-pending-1",
        tool_use_id: "tool-task-pending",
        subagent_type: "code-reviewer",
        description: "Stopped before task_started",
        session_id: "sdk-session-stop",
        uuid: "task-started-pending-1",
      } as unknown as SDKMessage);

      for (let i = 0; i < 10_000 && harness.query.stopTaskCalls.length < 2; i += 1) {
        yield* Effect.yieldNow;
      }
      assert.deepEqual(harness.query.stopTaskCalls, ["task-stop-1", "task-pending-1"]);
      assert.equal(harness.query.backgroundTasksCalls.length, 0);
      assert.equal(harness.query.interruptCalls.length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "revokes the shared gateway on child stop and still routes an exact whole-turn interrupt",
    () => {
      let releaseGateway!: () => void;
      const gatewayBarrier = new Promise<void>((resolve) => {
        releaseGateway = resolve;
      });
      const gateway = makeGatewayCredentialsHarness({
        cancelSessionTurnRequests: () => gatewayBarrier,
      });
      const harness = makeMultiQueryHarness({ gatewayCredentials: gateway.credentials });

      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });
        const turn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "wait in the visible browser",
          attachments: [],
        });
        const query = harness.queries[0]!;

        const childStopFiber = yield* adapter
          .interruptTurn(session.threadId, undefined, "tool-task-pending")
          .pipe(Effect.forkChild);
        for (let i = 0; i < 10_000 && gateway.cancelledTurns.length === 0; i += 1) {
          yield* Effect.yieldNow;
        }
        assert.deepEqual(gateway.cancelledTurns, [
          { token: "gateway-token-1", turnId: turn.turnId },
        ]);
        assert.equal(childStopFiber.pollUnsafe(), undefined);
        assert.equal(query.interruptCalls.length, 0);

        releaseGateway();
        yield* Fiber.join(childStopFiber);
        assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);

        yield* adapter.interruptTurn(session.threadId, TurnId.makeUnsafe("stale-turn"));
        assert.equal(gateway.cancelledTurns.length, 1);
        assert.equal(query.interruptCalls.length, 0);

        const interruptFiber = yield* adapter
          .interruptTurn(session.threadId, turn.turnId)
          .pipe(Effect.forkChild);
        for (let i = 0; i < 10_000 && query.interruptCalls.length === 0; i += 1) {
          yield* Effect.yieldNow;
        }
        assert.deepEqual(gateway.cancelledTurns, [
          { token: "gateway-token-1", turnId: turn.turnId },
        ]);
        assert.equal(query.interruptCalls.length, 1);
        yield* Fiber.join(interruptFiber);
        assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("delivers queued subagent steers through the PreToolUse hook", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.steered"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const hook = harness.getLastCreateQueryInput()?.options.hooks?.PreToolUse?.[0]?.hooks[0];
      assert.isDefined(hook);
      const invokeHook = (agentId: string | undefined) =>
        Effect.promise(() =>
          hook!(
            {
              hook_event_name: "PreToolUse",
              tool_name: "Read",
              tool_input: {},
              tool_use_id: "tool-read-1",
              session_id: "sdk-session-steer",
              transcript_path: "/tmp/transcript",
              cwd: "/tmp",
              ...(agentId ? { agent_id: agentId } : {}),
            } as HookInput,
            "tool-read-1",
            { signal: new AbortController().signal },
          ),
        );

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-steer-1",
        tool_use_id: "tool-task-steer-1",
        subagent_type: "worker-high",
        description: "Long-running task",
        session_id: "sdk-session-steer",
        uuid: "task-started-steer-1",
      } as unknown as SDKMessage);

      assert.deepEqual(yield* invokeHook("task-steer-1"), {});

      yield* adapter.steerSubagent(session.threadId, "tool-task-steer-1", {
        input: "Focus on the tests",
      });

      // Main-thread hook calls carry no agent_id and must never drain the queue.
      assert.deepEqual(yield* invokeHook(undefined), {});

      const delivered = yield* invokeHook("task-steer-1");
      assert.deepEqual(delivered, {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            "The user sent you a message mid-task: Focus on the tests. Address it and adjust your work accordingly.",
        },
      });

      assert.deepEqual(yield* invokeHook("task-steer-1"), {});

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const steered = runtimeEvents.find((event) => event.type === "turn.steered");
      assert.equal(steered?.type, "turn.steered");
      if (steered?.type === "turn.steered") {
        assert.equal(steered.payload.message, "Focus on the tests");
        assert.equal(steered.providerRefs?.providerThreadId, "tool-task-steer-1");
        assert.equal(steered.providerRefs?.providerParentThreadId, THREAD_ID);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("treats user-aborted Claude results as interrupted without a runtime error", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: false,
        errors: ["Error: Request was aborted."],
        stop_reason: "tool_use",
        session_id: "sdk-session-abort",
        uuid: "result-abort",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "turn.completed",
        ],
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Error: Request was aborted.");
        assert.equal(turnCompleted.payload.stopReason, "tool_use");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("closes the session when the Claude stream aborts after a turn starts", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];

      const runtimeEventsFiber = Effect.runFork(
        Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => {
            runtimeEvents.push(event);
          }),
        ),
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        lifecycleGeneration: "generation-claude-a",
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.fail(new Error("All fibers interrupted without error"));

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      runtimeEventsFiber.interruptUnsafe();
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "turn.completed",
          "session.exited",
        ],
      );
      assert.equal(
        runtimeEvents.every((event) => event.lifecycleGeneration === "generation-claude-a"),
        true,
      );

      const turnCompleted = runtimeEvents[4];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Claude runtime interrupted.");
      }

      const sessionExited = runtimeEvents[5];
      assert.equal(sessionExited?.type, "session.exited");

      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      const sessions = yield* adapter.listSessions();
      assert.equal(sessions.length, 0);
      assert.equal(harness.query.closeCalls, 1);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("invalidates a missing resumed conversation reported by the async stream", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: THREAD_ID,
          resume: "44c0b890-8775-4f30-b47f-0709d29cc9e1",
          resumeSessionAt: "assistant-stale",
          turnCount: 2,
        },
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "continue",
        attachments: [],
      });

      harness.query.fail(
        new Error("No conversation found with session ID: 44c0b890-8775-4f30-b47f-0709d29cc9e1"),
      );

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "runtime.error",
          "turn.completed",
          "session.exited",
        ],
      );
      const turnCompleted = runtimeEvents[5];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "failed");
        assert.equal(turnCompleted.providerRefs?.providerThreadId, undefined);
      }
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("retains Claude session ownership until subprocess-tree exit is proven", () => {
    const query = new FakeClaudeQuery();
    let proveExit: (() => void) | undefined;
    const exitProof = new Promise<void>((resolve) => {
      proveExit = resolve;
    });
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_311,
      exitCode: 0,
      signalCode: null,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterLive({
      spawnClaudeCodeProcess: () => ownedProcess,
      teardownProcessTree: async () => {
        teardownCalls += 1;
        await exitProof;
        return { escalated: false, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const stopping = yield* adapter.stopSession(THREAD_ID).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.equal(query.closeCalls, 1);
      assert.equal(teardownCalls, 1);
      assert.equal((yield* adapter.listSessions()).length, 1);

      proveExit?.();
      yield* Fiber.join(stopping);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("retains Claude ownership and retries when teardown proof fails", () => {
    const query = new FakeClaudeQuery();
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_312,
      exitCode: 0,
      signalCode: null,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterLive({
      spawnClaudeCodeProcess: () => ownedProcess,
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls === 1) {
          throw new Error("rootExited=false; surviving process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const failedStop = yield* Effect.exit(adapter.stopSession(THREAD_ID));
      assert.isTrue(Exit.isFailure(failedStop));
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      assert.equal((yield* adapter.listSessions()).length, 1);

      yield* adapter.stopSession(THREAD_ID);
      assert.equal(teardownCalls, 2);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("blocks a retry when createQuery spawned before failing cleanup", () => {
    const query = new FakeClaudeQuery();
    let allowStart = false;
    let createCalls = 0;
    let spawnCalls = 0;
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_313,
      exitCode: null,
      signalCode: null,
      once: () => undefined,
      removeListener: () => undefined,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterLive({
      spawnClaudeCodeProcess: () => {
        spawnCalls += 1;
        return ownedProcess;
      },
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls < 3) {
          throw new Error("rootExited=false; surviving process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        createCalls += 1;
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        if (!allowStart) {
          throw new Error("simulated failure after spawn");
        }
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const input = {
        threadId: THREAD_ID,
        provider: "claudeAgent" as const,
        runtimeMode: "full-access" as const,
      };

      assert.isTrue(Exit.isFailure(yield* Effect.exit(adapter.startSession(input))));
      assert.equal(createCalls, 1);
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 1);

      assert.isTrue(Exit.isFailure(yield* Effect.exit(adapter.startSession(input))));
      assert.equal(createCalls, 1);
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 2);

      allowStart = true;
      yield* adapter.startSession(input);
      assert.equal(createCalls, 2);
      assert.equal(spawnCalls, 2);
      assert.equal(teardownCalls, 3);

      yield* adapter.stopSession(THREAD_ID);
      assert.equal(teardownCalls, 4);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("blocks command rediscovery until an unproven process tree is reaped", () => {
    const query = new FakeClaudeQuery();
    let spawnCalls = 0;
    let teardownCalls = 0;
    const ownedProcess = {
      pid: 73_314,
      exitCode: null,
      signalCode: null,
      once: () => undefined,
      removeListener: () => undefined,
    } as unknown as ClaudeOwnedProcess;
    const layer = makeClaudeAdapterLive({
      spawnClaudeCodeProcess: () => {
        spawnCalls += 1;
        return ownedProcess;
      },
      teardownProcessTree: async () => {
        teardownCalls += 1;
        if (teardownCalls < 3) {
          throw new Error("rootExited=false; discovery process remains");
        }
        return { escalated: true, signalErrors: [] };
      },
      createQuery: (input) => {
        input.options.spawnClaudeCodeProcess?.({
          command: "claude",
          args: [],
          env: {},
          signal: new AbortController().signal,
        });
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const listCommands = adapter.listCommands;
      if (!listCommands) {
        assert.fail("Expected Claude adapter to support command discovery.");
      }
      const input = {
        provider: "claudeAgent" as const,
        cwd: "/tmp/project",
        forceReload: true,
      };

      assert.isTrue(Exit.isFailure(yield* Effect.exit(listCommands(input))));
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 1);

      assert.isTrue(Exit.isFailure(yield* Effect.exit(listCommands(input))));
      assert.equal(spawnCalls, 1);
      assert.equal(teardownCalls, 2);

      yield* adapter.stopAll();
      assert.equal(teardownCalls, 3);
    }).pipe(Effect.provide(layer));
  });

  it.effect("discovers Claude model capabilities before a session starts", () => {
    const query = new FakeClaudeQuery();
    let createQueryCalls = 0;
    (
      query as unknown as {
        supportedModels: () => Promise<
          Array<{
            value: string;
            resolvedModel: string;
            displayName: string;
            description: string;
            supportsAutoMode: boolean;
          }>
        >;
      }
    ).supportedModels = async () => {
      assert.ok(query.iteratorNextCalls > 0, "model discovery must drive the SDK handshake");
      return [
        {
          value: "claude-fable-5[1m]",
          resolvedModel: "claude-fable-5[1m]",
          displayName: "Fable",
          description: "Claude Fable 5",
          supportsAutoMode: true,
        },
      ];
    };
    const layer = makeClaudeAdapterLive({
      createQuery: () => {
        createQueryCalls += 1;
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const listModels = adapter.listModels;
      if (!listModels) {
        assert.fail("Expected Claude adapter to support model discovery.");
      }

      const discovered = yield* listModels({
        provider: "claudeAgent",
        cwd: "/tmp/project",
      });
      assert.equal(discovered.source, "sdk");
      assert.equal(discovered.cached, false);
      assert.lengthOf(discovered.models, 1);
      const { optionDescriptors, ...model } = discovered.models[0]!;
      assert.deepEqual(model, {
        slug: "claude-fable-5[1m]",
        resolvedModel: "claude-fable-5[1m]",
        name: "Fable",
        supportsAutoMode: true,
      });
      assert.deepEqual(
        optionDescriptors?.map((option) => option.id),
        ["effort", "autoCompactWindow"],
      );
      assert.deepEqual(
        optionDescriptors?.find((option) => option.id === "autoCompactWindow"),
        {
          id: "autoCompactWindow",
          label: "Auto-compact",
          type: "select",
          currentValue: "auto",
          options: [
            { id: "auto", label: "Auto (Claude Code)", isDefault: true },
            { id: "200k", label: "200k" },
            { id: "1m", label: "1M" },
          ],
        },
      );
      assert.equal(query.closeCalls, 1);
      assert.equal(createQueryCalls, 1);

      const cached = yield* listModels({
        provider: "claudeAgent",
        cwd: "/tmp/project",
      });
      assert.equal(cached.cached, true);
      assert.equal(createQueryCalls, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "emits completion only after turn result when assistant frames arrive before deltas",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });

        const turn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello",
          attachments: [],
        });

        harness.query.emit({
          type: "assistant",
          session_id: "sdk-session-early-assistant",
          uuid: "assistant-early",
          parent_tool_use_id: null,
          message: {
            id: "assistant-message-early",
            content: [
              { type: "tool_use", id: "tool-early", name: "Read", input: { path: "a.ts" } },
            ],
          },
        } as unknown as SDKMessage);

        harness.query.emit({
          type: "stream_event",
          session_id: "sdk-session-early-assistant",
          uuid: "stream-early",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Late text",
            },
          },
        } as unknown as SDKMessage);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-early-assistant",
          uuid: "result-early",
        } as unknown as SDKMessage);

        const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
        assert.deepEqual(
          runtimeEvents.map((event) => event.type),
          [
            "session.started",
            "session.configured",
            "session.state.changed",
            "turn.started",
            "thread.started",
            "content.delta",
            "item.completed",
            "turn.completed",
          ],
        );

        const deltaIndex = runtimeEvents.findIndex((event) => event.type === "content.delta");
        const completedIndex = runtimeEvents.findIndex((event) => event.type === "item.completed");
        assert.equal(deltaIndex >= 0 && completedIndex >= 0 && deltaIndex < completedIndex, true);

        const deltaEvent = runtimeEvents[deltaIndex];
        assert.equal(deltaEvent?.type, "content.delta");
        if (deltaEvent?.type === "content.delta") {
          assert.equal(deltaEvent.payload.delta, "Late text");
          assert.equal(String(deltaEvent.turnId), String(turn.turnId));
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

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

  it.effect(
    "lets active approval-required Computer tools reach the authoritative gateway gate",
    () => {
      const gateway = makeGatewayCredentialsHarness();
      const harness = makeMultiQueryHarness({ gatewayCredentials: gateway.credentials });
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "approval-required",
          enableComputerControl: true,
        });

        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "Click the target",
          attachments: [],
        });

        const hooks = harness.createInputs[0]!.options.hooks!.PreToolUse![0]!.hooks;
        for (const hook of hooks)
          yield* Effect.promise(() =>
            hook(
              {
                hook_event_name: "PreToolUse",
                tool_name: "mcp__glade__computer_click",
                tool_input: {},
                tool_use_id: "tool-use-computer-click",
                session_id: "sdk-computer",
                transcript_path: "/tmp/transcript",
                cwd: "/tmp",
              } as HookInput,
              "tool-use-computer-click",
              { signal: new AbortController().signal },
            ),
          );
        const turn = (yield* adapter.listSessions()).find(
          (session) => session.threadId === THREAD_ID,
        )?.activeTurnId;
        assert.isDefined(turn);
        assert.equal(
          yield* Effect.promise(() =>
            gateway.credentials.nativeToolCalls.resolve(
              "gateway-token-1",
              "tool-use-computer-click",
              "computer_click",
            ),
          ),
          turn,
        );

        const canUseTool = harness.createInputs[0]?.options.canUseTool;
        assert.equal(typeof canUseTool, "function");
        if (!canUseTool) {
          return;
        }

        const result = yield* Effect.promise(() =>
          canUseTool(
            "mcp__glade__computer_click",
            { x: 12, y: 34 },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-use-computer-click",
              requestId: "request-computer-click",
            },
          ),
        );

        assert.deepEqual(result, {
          behavior: "allow",
          updatedInput: { x: 12, y: 34 },
        });
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("passes Claude resume ids without pinning a stale assistant checkpoint", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: "resume-thread-1",
          resume: "550e8400-e29b-41d4-a716-446655440000",
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });

      assert.equal(session.threadId, RESUME_THREAD_ID);
      assert.deepEqual(session.resumeCursor, {
        threadId: RESUME_THREAD_ID,
        resume: "550e8400-e29b-41d4-a716-446655440000",
        resumeSessionAt: "assistant-99",
        turnCount: 3,
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.resume, "550e8400-e29b-41d4-a716-446655440000");
      assert.equal(createInput?.options.sessionId, undefined);
      assert.equal(createInput?.options.resumeSessionAt, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("preserves durable resume ids across Claude resume hooks", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const durableSessionId = "550e8400-e29b-41d4-a716-446655440000";
      const transientHookSessionId = "7368d0c7-40a3-4d8a-bcc1-ac80c49f2719";

      const threadStartedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "thread.started",
      ).pipe(Stream.runHead, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: "claudeAgent",
        resumeCursor: {
          threadId: RESUME_THREAD_ID,
          resume: durableSessionId,
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "continue",
        attachments: [],
      });

      harness.query.emit({
        type: "system",
        subtype: "hook_started",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        session_id: transientHookSessionId,
        uuid: "resume-hook-started",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "hook_response",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        output: "",
        stdout: "",
        stderr: "",
        outcome: "success",
        session_id: transientHookSessionId,
        uuid: "resume-hook-response",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: durableSessionId,
        uuid: "resume-stream-durable",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-resume-durable",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Fiber.join(threadStartedFiber);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag === "Some" && threadStarted.value.type === "thread.started") {
        const rawPayload =
          threadStarted.value.raw?.payload &&
          typeof threadStarted.value.raw.payload === "object" &&
          "session_id" in threadStarted.value.raw.payload
            ? threadStarted.value.raw.payload.session_id
            : undefined;
        assert.equal(threadStarted.value.payload?.providerThreadId ?? rawPayload, durableSessionId);
      }

      const activeSessions = yield* adapter.listSessions();
      const resumeCursor = activeSessions[0]?.resumeCursor as
        | {
            readonly resume?: string;
          }
        | undefined;
      assert.equal(resumeCursor?.resume, durableSessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "rewinds Claude through the native parent including hidden tool output, then resumes it",
    () => {
      const forks: unknown[] = [];
      const harness = makeMultiQueryHarness({
        nativeHistory: {
          readNativeSessionMessages: async () => [
            {
              type: "user",
              uuid: "kept-user",
              message: { content: "remember 42" },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "assistant",
              uuid: "kept-assistant",
              message: { content: [{ type: "tool_use" }] },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "user",
              uuid: "tool-result",
              message: { content: [{ type: "tool_result" }] },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
            {
              type: "user",
              uuid: "edited-user",
              message: { content: "discard this" },
              session_id: "9b37f02e-489d-4454-9f76-67a571840245",
              parent_tool_use_id: null,
              parent_agent_id: null,
            },
          ],
          readNativeMessageParent: async ({ messageId }) => {
            assert.equal(messageId, "edited-user");
            return "structured-output-after-tool-result";
          },
          forkNativeSession: async (sessionId, options) => {
            forks.push({ sessionId, options });
            return { sessionId: "24dbd86f-55d1-4de2-8138-7d7bd04563c5" };
          },
        },
      });
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
          resumeCursor: { resume: "9b37f02e-489d-4454-9f76-67a571840245" },
        });
        yield* adapter.rollbackThread(THREAD_ID, 1);
        assert.deepEqual(forks, [
          {
            sessionId: "9b37f02e-489d-4454-9f76-67a571840245",
            options: { upToMessageId: "structured-output-after-tool-result" },
          },
        ]);
        assert.equal(
          harness.createInputs[1]?.options.resume,
          "24dbd86f-55d1-4de2-8138-7d7bd04563c5",
        );
        const sessions = yield* adapter.listSessions();
        assert.equal(
          (sessions[0]!.resumeCursor as { resume: string }).resume,
          "24dbd86f-55d1-4de2-8138-7d7bd04563c5",
        );
        const turn = yield* adapter.sendTurn({ threadId: THREAD_ID, input: "edited prompt" });
        assert.ok(turn.turnId);
        assert.equal(harness.queries.length, 2);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect(
    "refuses to edit when native history is unavailable instead of trimming only local turns",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
        });

        const firstTurn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "first",
          attachments: [],
        });

        const firstCompletedFiber = yield* Stream.filter(
          adapter.streamEvents,
          (event) => event.type === "turn.completed",
        ).pipe(Stream.runHead, Effect.forkChild);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-rollback",
          uuid: "result-first",
        } as unknown as SDKMessage);

        const firstCompleted = yield* Fiber.join(firstCompletedFiber);
        assert.equal(firstCompleted._tag, "Some");
        if (firstCompleted._tag === "Some" && firstCompleted.value.type === "turn.completed") {
          assert.equal(String(firstCompleted.value.turnId), String(firstTurn.turnId));
        }

        const secondTurn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "second",
          attachments: [],
        });

        const secondCompletedFiber = yield* Stream.filter(
          adapter.streamEvents,
          (event) => event.type === "turn.completed",
        ).pipe(Stream.runHead, Effect.forkChild);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-rollback",
          uuid: "result-second",
        } as unknown as SDKMessage);

        const secondCompleted = yield* Fiber.join(secondCompletedFiber);
        assert.equal(secondCompleted._tag, "Some");
        if (secondCompleted._tag === "Some" && secondCompleted.value.type === "turn.completed") {
          assert.equal(String(secondCompleted.value.turnId), String(secondTurn.turnId));
        }

        const threadBeforeRollback = yield* adapter.readThread(session.threadId);
        assert.equal(threadBeforeRollback.turns.length, 2);

        const rolledBack = yield* Effect.exit(adapter.rollbackThread(session.threadId, 1));
        assert.ok(Exit.isFailure(rolledBack));

        const threadAfterRollback = yield* adapter.readThread(session.threadId);
        assert.equal(threadAfterRollback.turns.length, 2);
        assert.equal(threadAfterRollback.turns[0]?.id, firstTurn.turnId);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("rejects unsupported live model switches before changing an Auto session", () => {
    const query = new FakeClaudeQuery();
    (
      query as unknown as {
        supportedModels: () => Promise<
          Array<{ value: string; displayName: string; supportsAutoMode: boolean }>
        >;
      }
    ).supportedModels = async () => [
      {
        value: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        supportsAutoMode: true,
      },
      {
        value: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        supportsAutoMode: false,
      },
      {
        value: "claude-fable-5",
        displayName: "Claude Fable 5",
        supportsAutoMode: true,
      },
    ];
    const layer = makeClaudeAdapterLive({ createQuery: () => query }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "auto",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
      });

      const unsupportedSwitch = yield* Effect.exit(
        adapter.sendTurn({
          threadId: session.threadId,
          input: "switch to Haiku",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
          },
          attachments: [],
        }),
      );

      assert.ok(Exit.isFailure(unsupportedSwitch));
      assert.deepEqual(query.setModelCalls, []);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "switch to Fable",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-fable-5",
        },
        attachments: [],
      });
      assert.deepEqual(query.setModelCalls, ["claude-fable-5"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("leaves no Claude runtime when replacement spawn fails", () => {
    const harness = makeMultiQueryHarness({ failCreateAt: 1 });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
        modelSelection: { provider: "claudeAgent", model: "claude-opus-4-8" },
      });
      const firstQuery = harness.queries[0];
      assert.ok(firstQuery);

      const replacement = yield* Effect.exit(
        adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "full-access",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-opus-4-8",
            options: { effort: "max" },
          },
        }),
      );

      assert.ok(Exit.isFailure(replacement));
      assert.equal(firstQuery.closeCalls, 1);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      assert.equal((yield* adapter.listSessions()).length, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("releases the gateway lease when the Claude stream aborts spontaneously", () => {
    const gateway = makeGatewayCredentialsHarness();
    const harness = makeMultiQueryHarness({ gatewayCredentials: gateway.credentials });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.queries[0]?.fail(new Error("All fibers interrupted without error"));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.deepEqual(gateway.revokedTokens, ["gateway-token-1"]);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("counts repeated Claude content blocks once and reconciles provisional output", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      const collectTurn = () =>
        adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
      const observed = yield* collectTurn();
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "first", attachments: [] });
      const emitBlock = (uuid: string, output: number, id = "request-1") => {
        harness.query.emit({
          type: "assistant",
          session_id: "sdk-block-accounting",
          uuid,
          parent_tool_use_id: null,
          request_id: id,
          message: {
            id,
            content: [{ type: "text", text: uuid }],
            usage: {
              input_tokens: 32,
              cache_creation_input_tokens: 419,
              cache_read_input_tokens: 26_816,
              output_tokens: output,
            },
          },
        } as unknown as SDKMessage);
      };
      emitBlock("thinking-block", 59);
      emitBlock("text-block", 59);
      emitBlock("text-block", 59);
      emitBlock("later-output", 100);
      emitBlock("distinct-request", 59, "request-2");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-1", {
        total_tokens: 54_700,
      });
      const events = Array.from(yield* Fiber.join(observed));
      assert.deepEqual(
        events
          .filter((event) => event.type === "thread.token-usage.updated")
          .map((event) => event.payload.usage.totalProcessedTokens),
        [27_326, 27_326, 27_326, 27_367, 54_693, 54_700],
      );

      const next = yield* collectTurn();
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "second", attachments: [] });
      emitBlock("next-request", 59, "request-3");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-2", {
        total_tokens: 27_320,
      });
      const nextEvents = Array.from(yield* Fiber.join(next));
      const usage = nextEvents.filter((event) => event.type === "thread.token-usage.updated");
      assert.deepEqual(
        usage.map((event) => event.payload.usage.totalProcessedTokens),
        [82_026, 82_020],
      );
      const zero = yield* collectTurn();
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "zero-usage command",
        attachments: [],
      });
      emitBlock("synthetic-output", 0, "request-4");
      emitSuccessResult(harness.query, "sdk-block-accounting", "result-zero", {
        input_tokens: 0,
        output_tokens: 0,
      });
      const zeroEvents = Array.from(yield* Fiber.join(zero));
      assert.equal(
        zeroEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
        0,
      );
      assert.equal(
        zeroEvents.findLast((event) => event.type === "thread.token-usage.updated")?.payload.usage
          .totalProcessedTokens,
        82_020,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "keeps request accounting across interruption, late delivery, clear, and resume",
    () => {
      const harness = makeMultiQueryHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const start = {
          threadId: THREAD_ID,
          provider: "claudeAgent" as const,
          runtimeMode: "full-access" as const,
        };
        yield* adapter.startSession(start);
        let query = harness.queries[0]!;
        const collect = () =>
          adapter.streamEvents.pipe(
            Stream.takeUntil((event) => event.type === "turn.completed"),
            Stream.runCollect,
            Effect.forkChild,
          );
        const first = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "first", attachments: [] });
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "block-1",
          "partial",
          { input_tokens: 100 },
          "call-1",
        );
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "block-2",
          "partial",
          { input_tokens: 100 },
          "call-1",
        );
        yield* adapter.interruptTurn(THREAD_ID);
        const failed = {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["interrupted"],
          session_id: "sdk-lifecycle",
          uuid: "failed-result",
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
          total_cost_usd: 0,
        } as unknown as SDKMessage;
        query.emit(failed);
        const firstEvents = Array.from(yield* Fiber.join(first));
        assert.equal(
          firstEvents.find((event) => event.type === "turn.completed")?.payload.mainLoopTokens,
          100,
        );
        assert.equal(
          firstEvents.find((event) => event.type === "turn.completed")?.payload.state,
          "interrupted",
        );

        const next = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "next", attachments: [] });
        query.emit(failed);
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "late-block",
          "tail",
          { input_tokens: 100 },
          "call-1",
        );
        emitAssistantUsage(
          query,
          "sdk-lifecycle",
          "new-block",
          "next",
          { input_tokens: 20 },
          "call-2",
        );
        emitSuccessResult(query, "sdk-lifecycle", "next-result", { input_tokens: 20 });
        const nextEvents = Array.from(yield* Fiber.join(next));
        assert.deepEqual(
          nextEvents
            .filter((event) => event.type === "thread.token-usage.updated")
            .map((event) => event.payload.usage.totalProcessedTokens),
          [100, 120, 120],
        );

        const cleared = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "/clear", attachments: [] });
        query.emit({
          type: "conversation_reset",
          new_conversation_id: "new-lifecycle",
          session_id: "sdk-lifecycle",
          uuid: "clear",
        } as unknown as SDKMessage);
        emitAssistantUsage(
          query,
          "new-lifecycle",
          "after-clear",
          "cleared",
          { input_tokens: 20 },
          "call-2",
        );
        emitSuccessResult(query, "new-lifecycle", "clear-result", { input_tokens: 20 });
        yield* Fiber.join(cleared);
        const resumeCursor = (yield* adapter.listSessions())[0]!.resumeCursor;
        assert.equal((resumeCursor as { processedTokenTotal?: number }).processedTokenTotal, 140);
        yield* adapter.stopSession(THREAD_ID);
        yield* adapter.startSession({ ...start, resumeCursor });
        query = harness.queries[1]!;
        const resumed = yield* collect();
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "resumed", attachments: [] });
        emitAssistantUsage(query, "new-lifecycle", "resumed-block", "resumed", {
          input_tokens: 10,
        });
        emitSuccessResult(query, "new-lifecycle", "resumed-result", { input_tokens: 10 });
        const events = Array.from(yield* Fiber.join(resumed));
        assert.deepEqual(
          events
            .filter((event) => event.type === "thread.token-usage.updated")
            .map((event) => event.payload.usage.totalProcessedTokens),
          [150, 150],
        );
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("resumes cumulative token accounting from the durable cursor", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const usageFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "thread.token-usage.updated",
      ).pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
        resumeCursor: {
          threadId: THREAD_ID,
          processedTokenTotal: 350_000,
          tokenAccountingVersion: 1,
        },
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "continue",
        attachments: [],
      });
      emitAssistantUsage(
        harness.query,
        "sdk-session-resumed-accounting",
        "assistant-resumed-accounting",
        "Fresh response",
        { input_tokens: 1, cache_read_input_tokens: 19_999, output_tokens: 0 },
      );
      emitSuccessResult(
        harness.query,
        "sdk-session-resumed-accounting",
        "result-resumed-accounting",
        { total_tokens: 50_000 },
      );

      const usageEvents = Array.from(yield* Fiber.join(usageFiber));
      assertTokenUsageEvent(usageEvents[0]);
      const { claudeCache, ...resumedUsage } = usageEvents[0].payload.usage;
      assert.equal(claudeCache?.source, "request-usage");
      assert.deepEqual(resumedUsage, {
        usedTokens: 20_000,
        tokenAccountingVersion: 1,
        lastUsedTokens: 20_000,
        totalProcessedTokens: 370_000,
        maxTokens: 1_000_000,
        inputTokens: 20_000,
      });
      assertTokenUsageEvent(usageEvents[1]);
      assert.equal(usageEvents[1].payload.usage.totalProcessedTokens, 400_000);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("sets plan permission mode on sendTurn when interactionMode is plan", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "plan this for me",
        interactionMode: "plan",
        attachments: [],
      });

      assert.deepEqual(harness.query.setPermissionModeCalls, ["plan"]);
      const promptText = yield* Effect.promise(() =>
        readFirstPromptText(harness.getLastCreateQueryInput()),
      );
      assert.include(promptText ?? "", "Glade plan mode is active.");
      assert.include(promptText ?? "", "<proposed_plan>");
      assert.include(promptText ?? "", "User request:\nplan this for me");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("does not leave Claude in plan mode when a follow-up omits interactionMode", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "plan this",
        interactionMode: "plan",
        attachments: [],
      });

      const turnCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-plan-omitted-reset",
        uuid: "result-plan-omitted-reset",
      } as unknown as SDKMessage);

      yield* Fiber.join(turnCompletedFiber);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "now build it",
        attachments: [],
      });

      assert.deepEqual(harness.query.setPermissionModeCalls, ["plan", "bypassPermissions"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("captures ExitPlanMode as a proposed plan and denies auto-exit", () => {
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
        input: "plan this",
        interactionMode: "plan",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "ExitPlanMode",
        {
          plan: "# Ship it\n\n- one\n- two",
          allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
        },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-exit-1",
          requestId: "request-tool-exit-1",
        },
      );

      const proposedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(proposedEvent._tag, "Some");
      if (proposedEvent._tag !== "Some") {
        return;
      }
      assert.equal(proposedEvent.value.type, "turn.proposed.completed");
      if (proposedEvent.value.type !== "turn.proposed.completed") {
        return;
      }
      assert.equal(proposedEvent.value.payload.planMarkdown, "# Ship it\n\n- one\n- two");
      assert.deepEqual(proposedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.makeUnsafe("tool-exit-1"),
      });

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "deny");
      const deniedResult = permissionResult as PermissionResult & {
        message?: string;
      };
      assert.equal(deniedResult.message?.includes("captured your proposed plan"), true);
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

describe("ClaudeAdapterLive forkThread", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkdtempSync(path.join(os.tmpdir(), "claude-fork-config-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
  });
  const SOURCE_SESSION_ID = "7f9c2f60-1111-4a2b-9c3d-8e5f6a7b8c9d";

  function makeForkLayer(
    forkNativeSession: NonNullable<ClaudeAdapterLiveOptions["forkNativeSession"]>,
  ) {
    return makeClaudeAdapterLive({ forkNativeSession }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );
  }

  it.effect("forks natively from the persisted cursor and drops source uuid pins", () => {
    const forkCalls: Array<{
      readonly sessionId: string;
      readonly options: { readonly dir?: string; readonly upToMessageId?: string } | undefined;
    }> = [];
    const layer = makeForkLayer(async (sessionId, options) => {
      forkCalls.push({ sessionId, options });
      return { sessionId: "forked-session-1" };
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceCwd: "/repo/source",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
          resumeSessionAt: "assistant-uuid-9",
          turnCount: 4,
        },
      });

      assert.deepEqual(forkCalls, [
        {
          sessionId: SOURCE_SESSION_ID,
          options: { dir: "/repo/source", upToMessageId: "assistant-uuid-9" },
        },
      ]);

      assert.deepEqual(result, {
        threadId: RESUME_THREAD_ID,
        resumeCursor: {
          threadId: RESUME_THREAD_ID,
          resume: "forked-session-1",
          turnCount: 4,
          processedTokenTotal: 0,
          tokenAccountingVersion: 1,
        },
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("refuses a native fork while the source turn is in flight", () => {
    const query = new FakeClaudeQuery();
    let forkCalls = 0;
    const layer = makeClaudeAdapterLive({
      createQuery: () => query,
      forkNativeSession: async () => {
        forkCalls += 1;
        return { sessionId: "unexpected" };
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "Long-running work",
        attachments: [],
      });

      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
        },
      }).pipe(Effect.result);

      assert.equal(forkCalls, 0);
      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.instanceOf(result.failure, ProviderAdapterValidationError);
      if (Schema.is(ProviderAdapterValidationError)(result.failure)) {
        assert.include(result.failure.issue, "turn in flight");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("maps a native fork failure to a session/fork request error", () => {
    const layer = makeForkLayer(async () => {
      throw new Error("session file missing");
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
        },
      }).pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.instanceOf(result.failure, ProviderAdapterRequestError);
      if (Schema.is(ProviderAdapterRequestError)(result.failure)) {
        assert.equal(result.failure.method, "session/fork");
        assert.include(result.failure.detail, "session file missing");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });
});

describe("Claude explicit native compaction", () => {
  it.effect(
    "rejects attachments on native compaction before creating a turn or reading files",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        yield* adapter.startSession({ threadId: THREAD_ID, runtimeMode: "full-access" });
        const result = yield* adapter
          .sendTurn({
            threadId: THREAD_ID,
            input: "/compact retain the plan",
            attachments: [
              {
                type: "image",
                id: "missing-image-12345678-1234-1234-1234-123456789abc",
                name: "diagram.png",
                mimeType: "image/png",
                sizeBytes: 4,
              },
            ],
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, ProviderAdapterValidationError);
          assert.include(String(result.failure), "does not accept attachments");
        }
        assert.isUndefined((yield* adapter.listSessions())[0]?.activeTurnId);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );
});

describe("Claude cache preflight", () => {
  const nativeSessionId = "21d6c45d-b52f-4d3b-a7b1-dcb6bc8d8ba1";
  const resumedObservation = {
    nativeSessionId,
    lifecycleGeneration: "previous-generation",
    observedAt: "1970-01-01T00:00:00.000Z",
    lastResponseAt: "1970-01-01T00:00:00.000Z",
    contextTokens: 896542,
    ttlSeconds: 3600,
    state: "likely-warm" as const,
    source: "request-usage" as const,
  };

  it.effect("ignores a retired process's late hook and mismatched persisted identity", () => {
    const harness = makeMultiQueryHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        runtimeMode: "full-access",
        resumeCursor: { resume: nativeSessionId },
      });
      const oldHook = harness.createInputs[0]!.options.hooks!.SessionStart![0]!.hooks[0]!;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        runtimeMode: "full-access",
        resumeCursor: {
          resume: nativeSessionId,
          claudeCache: { ...resumedObservation, nativeSessionId: "another-session" },
        },
      });
      yield* Effect.promise(() =>
        oldHook(
          {
            hook_event_name: "SessionStart",
            session_id: nativeSessionId,
            source: "resume",
            context_tokens: 999999,
            prompt_cache_likely_expired: true,
            transcript_path: "/tmp/fixture.jsonl",
            cwd: "/tmp",
          },
          undefined,
          { signal: new AbortController().signal },
        ),
      );
      assert.isUndefined(yield* adapter.getClaudeCacheObservation!(THREAD_ID));
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
