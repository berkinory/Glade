import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterAll, beforeAll } from "vitest";
import { type ClaudeAdapterLiveOptions } from "./adapterConfiguration.ts";
import { makeClaudeAdapterLive as makeClaudeAdapterLiveBase } from "../../Layers/ClaudeAdapter.ts";
import { PROVIDER_COMPATIBILITY } from "../../core/compatibility.ts";
import type {
  SDKMessage,
  SDKControlGetContextUsageResponse,
  PermissionMode,
  ModelInfo,
  Options as ClaudeQueryOptions,
  SDKUserMessage,
  SDKControlInitializeResponse,
  McpServerStatus,
  SDKControlReloadPluginsResponse,
  CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect, Layer, Option, Stream } from "effect";
import { assert } from "@effect/vitest";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import { ServerConfig } from "../../../server/config.ts";
import { ServerSettingsService } from "../../../settings/serverSettings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type AgentGatewayCredentialsShape,
  AgentGatewayCredentials,
} from "../../../agentGateway/Services/AgentGatewayCredentials.ts";
import { makeNativeToolCallRegistry } from "../../../agentGateway/nativeToolCalls.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";

// Session start resolves the Claude CLI on PATH before using the injected SDK query, so a stub
// executable keeps these tests independent of a host Claude install.
const fakeClaudeBinDir = mkdtempSync(join(tmpdir(), "glade-claude-bin-"));
writeFileSync(join(fakeClaudeBinDir, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
// Assigned directly rather than with vi.stubEnv, which suites reset per test with unstubAllEnvs.
const hostPath = process.env.PATH;
beforeAll(() => {
  process.env.PATH = `${fakeClaudeBinDir}${delimiter}${hostPath ?? ""}`;
});
afterAll(() => {
  if (hostPath === undefined) delete process.env.PATH;
  else process.env.PATH = hostPath;
  rmSync(fakeClaudeBinDir, { recursive: true, force: true });
});

function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  return makeClaudeAdapterLiveBase({
    readClaudeCliVersion: async () => PROVIDER_COMPATIBILITY.claudeAgent.minimumVersion,
    ...options,
  }).pipe(Layer.provide(ServerSettingsService.layerTest()));
}

export function makeClaudeAdapterTestLayer(
  options?: ClaudeAdapterLiveOptions,
  config?: { readonly cwd?: string; readonly baseDir?: string },
) {
  return makeClaudeAdapterLive(options).pipe(
    Layer.provideMerge(
      ServerConfig.layerTest(config?.cwd ?? "/tmp/claude-adapter-test", config?.baseDir ?? "/tmp"),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

export class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
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
  public readonly applyFlagSettingsCalls: Array<Record<string, unknown>> = [];
  public iteratorNextCalls = 0;
  public closeCalls = 0;
  public supportedCommandList: Array<{ name: string; description: string; argumentHint: string }> =
    [];

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

  readonly setMaxThinkingTokens = async (_maxThinkingTokens: number | null): Promise<void> => {};

  readonly applyFlagSettings = async (settings: Record<string, unknown>): Promise<void> => {
    this.applyFlagSettingsCalls.push(settings);
  };

  readonly getContextUsage = async (_options?: {
    readonly detail?: "summary" | "full";
  }): Promise<SDKControlGetContextUsageResponse> => {
    throw new Error("Context usage unavailable in this test.");
  };

  readonly supportedCommands = async (): Promise<
    Array<{ name: string; description: string; argumentHint: string }>
  > => this.supportedCommandList;

  readonly supportedModels = async (): Promise<Array<ModelInfo>> => {
    return [
      {
        value: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        description: "Default supported test model",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        supportsAdaptiveThinking: true,
        supportsFastMode: false,
        supportsAutoMode: true,
      },
    ];
  };

  readonly supportedAgents = async (): Promise<[]> => {
    return [];
  };

  readonly initializationResult = async (): Promise<SDKControlInitializeResponse> =>
    ({
      commands: await this.supportedCommands(),
      agents: await this.supportedAgents(),
      models: await this.supportedModels(),
      account: { email: "test@example.invalid" },
      output_style: "default",
      available_output_styles: [],
    }) as SDKControlInitializeResponse;

  readonly mcpServerStatus = async (): Promise<McpServerStatus[]> => [];

  readonly reconnectMcpServer = async (_name: string): Promise<void> => {};

  readonly toggleMcpServer = async (_name: string, _enabled: boolean): Promise<void> => {};

  readonly reloadPlugins = async (): Promise<SDKControlReloadPluginsResponse> => ({
    plugins: [],
    commands: [],
    agents: [],
    mcpServers: [],
    error_count: 0,
  });

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

export function makeHarness(config?: { readonly cwd?: string; readonly baseDir?: string }) {
  const query = new FakeClaudeQuery();
  let createInput:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }
    | undefined;

  return {
    layer: makeClaudeAdapterTestLayer(
      {
        createQuery: (input) => {
          createInput = input;
          return query;
        },
      },
      config,
    ),
    query,
    getLastCreateQueryInput: () => createInput,
  };
}

export function makeMultiQueryHarness(config?: {
  readonly nativeHistory?: Pick<
    ClaudeAdapterLiveOptions,
    | "readNativeSessionMessages"
    | "readNativeMessageParent"
    | "forkNativeSession"
    | "deleteNativeSession"
  >;
  readonly failCreateAt?: number;
  readonly gatewayCredentials?: AgentGatewayCredentialsShape;
}) {
  const queries: Array<FakeClaudeQuery> = [];
  const createInputs: Array<{
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }> = [];
  let layer = makeClaudeAdapterTestLayer({
    deleteNativeSession: async () => {},
    ...config?.nativeHistory,
    createQuery: (input) => {
      if (queries.length === config?.failCreateAt) {
        throw new Error("simulated Claude spawn failure");
      }
      const query = new FakeClaudeQuery();
      queries.push(query);
      createInputs.push(input);
      return query;
    },
  });
  if (config?.gatewayCredentials) {
    layer = layer.pipe(
      Layer.provideMerge(Layer.succeed(AgentGatewayCredentials, config.gatewayCredentials)),
    );
  }

  return { layer, queries, createInputs };
}

export function makeGatewayCredentialsHarness(options?: {
  readonly cancelSessionTurnRequests?: (token: string, turnId: string) => Promise<void>;
}) {
  let sequence = 0;
  const revokedTokens: string[] = [];
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
    connectionForThread: () => ({
      url: "http://127.0.0.1:48123/mcp",
      bearerToken: `gateway-token-${++sequence}`,
    }),
  } satisfies AgentGatewayCredentialsShape;
  return { cancelledTurns, credentials, revokedTokens };
}

export function makeDeterministicRandomService(seed = 0x1234_5678): {
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

export function emitAssistantUsage(
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

export function emitSuccessResult(
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

export async function readFirstPromptMessage(
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

export const THREAD_ID = ThreadId.makeUnsafe("thread-claude-1");

export const RESUME_THREAD_ID = ThreadId.makeUnsafe("thread-claude-resume");

// A missing event leaves the stream waiting until the suite's test timeout; a wrong one fails here.
export const nextEvent = <T extends ProviderRuntimeEvent["type"]>(type: T) =>
  Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter;
    const next = yield* Stream.runHead(adapter.streamEvents);
    assert.equal(Option.isSome(next) ? next.value.type : "<stream ended>", type);
    return Option.getOrThrow(next) as Extract<ProviderRuntimeEvent, { readonly type: T }>;
  });

export function requireCanUseTool(harness: {
  readonly getLastCreateQueryInput: () => { readonly options: ClaudeQueryOptions } | undefined;
}): CanUseTool {
  const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
  if (!canUseTool) return assert.fail("Expected the Claude query to receive canUseTool.");
  return canUseTool;
}
