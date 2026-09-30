import type {
  SDKMessage,
  PermissionMode,
  Settings,
  SDKControlGetContextUsageResponse,
  SlashCommand,
  ModelInfo,
  AgentInfo,
  SpawnedProcess as ClaudeSpawnedProcess,
  SDKUserMessage,
  Options as ClaudeQueryOptions,
  SessionMessage,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ProcessExitHandle,
  teardownProviderProcessTree,
} from "../../../platform/supervisedProcessTeardown";
import { readClaudeSessionParentUuid } from "../claudeProjectImport.ts";
import { type EventNdjsonLogger } from "../../Layers/EventNdjsonLogger.ts";

export interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>;
  readonly stopTask: (taskId: string) => Promise<void>;
  readonly backgroundTasks: (toolUseId?: string) => Promise<boolean>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly applyFlagSettings: (settings: {
    [K in keyof Settings]?: Settings[K] | null;
  }) => Promise<void>;
  readonly getContextUsage: (options?: {
    readonly detail?: "summary" | "full";
  }) => Promise<SDKControlGetContextUsageResponse>;
  readonly supportedCommands: () => Promise<SlashCommand[]>;
  readonly supportedModels: () => Promise<ModelInfo[]>;
  readonly supportedAgents: () => Promise<AgentInfo[]>;
  readonly close: () => void;
}

export type ClaudeOwnedProcess = ClaudeSpawnedProcess & ProcessExitHandle;

export interface ClaudeProcessOwner {
  process?: ClaudeOwnedProcess;
}

export interface ClaudeAdapterLiveOptions {
  // Async because the default implementation lazily imports the Claude Agent SDK; test doubles may
  // still return a runtime synchronously.
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeQueryRuntime | Promise<ClaudeQueryRuntime>;
  readonly forkNativeSession?: (
    sessionId: string,
    options?: { readonly dir?: string; readonly upToMessageId?: string },
  ) => Promise<{ sessionId: string }>;
  readonly readNativeSessionMessages?: (
    sessionId: string,
    options?: { readonly dir?: string },
  ) => Promise<ReadonlyArray<SessionMessage>>;
  readonly readNativeMessageParent?: typeof readClaudeSessionParentUuid;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;

  readonly workflowRuntimePollIntervalMs?: number;
  readonly spawnClaudeCodeProcess?: (options: ClaudeSpawnOptions) => ClaudeOwnedProcess;
  readonly teardownProcessTree?: typeof teardownProviderProcessTree;
  readonly readClaudeCliVersion?: (input: {
    readonly binaryPath: string;
    readonly cwd?: string;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<string | null>;
}
