import { Schema } from "effect";
import { TrimmedNonEmptyString, NonNegativeInt } from "../core/baseSchemas";
import { CodexModelOptions, ClaudeModelOptions } from "./model";

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;

export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(CodexModelOptions),
});

export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(ClaudeModelOptions),
  supportsAutoMode: Schema.optional(Schema.Boolean),
});

export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const ModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection]);

export type ModelSelection = typeof ModelSelection.Type;

export const CodexProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  homePath: Schema.optional(TrimmedNonEmptyString),
});

export const ClaudeProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  permissionMode: Schema.optional(TrimmedNonEmptyString),
  maxThinkingTokens: Schema.optional(NonNegativeInt),
  enableArtifacts: Schema.optional(Schema.Boolean),
});

export const ProviderStartOptions = Schema.Struct({
  codex: Schema.optional(CodexProviderStartOptions),
  claudeAgent: Schema.optional(ClaudeProviderStartOptions),
  // Settings allows Computer Use, so the harness policy carries the computer guidance.
  allowComputerUse: Schema.optional(Schema.Boolean),
});

export type ProviderStartOptions = typeof ProviderStartOptions.Type;

export const RuntimeMode = Schema.Literals(["approval-required", "auto", "full-access"]);

export type RuntimeMode = typeof RuntimeMode.Type;

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "permissions",
  "tool",
]);

export type ProviderRequestKind = typeof ProviderRequestKind.Type;

export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);

export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;

export const TurnDispatchMode = Schema.Literals(["queue", "steer"]);

export type TurnDispatchMode = typeof TurnDispatchMode.Type;

export const DEFAULT_TURN_DISPATCH_MODE: TurnDispatchMode = "queue";

// Retired origins remain decodable in persisted conversation history.
export const MessageDispatchOrigin = Schema.Literals(["user", "automation", "agent"]);

export type MessageDispatchOrigin = typeof MessageDispatchOrigin.Type;

export const ThreadCreationSource = Schema.Literals([
  "glade_mcp",
  "external_mcp",
  "provider_native",
  "automation_run",
]);

export type ThreadCreationSource = typeof ThreadCreationSource.Type;

export const ProviderReviewTarget = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("uncommittedChanges"),
  }),
  Schema.Struct({
    type: Schema.Literal("baseBranch"),
    branch: TrimmedNonEmptyString,
  }),
]);

export type ProviderReviewTarget = typeof ProviderReviewTarget.Type;

export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;

export const ProviderUserInputAnswer = Schema.NullOr(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);

export type ProviderUserInputAnswer = typeof ProviderUserInputAnswer.Type;

export const ProviderUserInputAnswers = Schema.Record(Schema.String, ProviderUserInputAnswer);

export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);

export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;
