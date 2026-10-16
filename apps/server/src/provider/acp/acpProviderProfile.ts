import type {
  ClientSideConnection,
  PromptResponse,
  SessionConfigOption,
  Usage,
} from "@agentclientprotocol/sdk";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import type { ProviderUserMcpServers } from "../core/configuredMcpServers.ts";

export type AcpPromptUsage = (response: PromptResponse) => Usage | undefined;

export type AcpInnerToolCall = (
  rawOutput: unknown,
) => { readonly name: string; readonly input: unknown } | undefined;

export interface AcpModelDescription {
  readonly slug: string;
  readonly name: string;
  readonly configOptions: ReadonlyArray<SessionConfigOption>;
}

// Everything that differs between agents that speak ACP. Shared ACP code reads this record and
// never branches on a provider kind.
export interface AcpProviderProfile {
  readonly provider: ProviderKind;
  readonly displayName: string;
  readonly args: ReadonlyArray<string>;
  // Environment for the agent process; runtime modes the agent enforces through its own
  // configuration are applied here.
  readonly env?: (input: { readonly runtimeMode: RuntimeMode }) => NodeJS.ProcessEnv;
  // Sent after `initialize` when the agent advertises it; agents that reuse the CLI's stored login
  // still require the call.
  readonly authMethodId?: string;
  // Session config option values applied after a session opens: the agent's normal working mode
  // (never a plan or read-only mode) and anything the runtime mode needs natively.
  readonly sessionConfig?: (input: {
    readonly runtimeMode: RuntimeMode;
  }) => ReadonlyArray<{ readonly configId: string; readonly value: string }>;
  // A fast model for conversation titles, used when the account's catalog offers it.
  readonly titleModel?: string;
  // The agent saves every model switch as the default of its own CLI, so Glade switches models
  // only for the user's chats: discovery and title requests stay on the current model.
  readonly savesModelChoiceGlobally?: boolean;
  // Client capability metadata the agent reads in `initialize` to unlock richer behavior.
  readonly clientMeta?: Readonly<Record<string, unknown>>;
  // The agent's own list of every model with its settings, read without switching models.
  readonly describeModels?: (
    agent: ClientSideConnection,
  ) => Promise<ReadonlyArray<AcpModelDescription>>;
  // The vendor label that groups a model in the picker, for agents that do not name it.
  readonly modelVendor?: (slug: string) => string | undefined;
  // The full arguments that also put Glade's harness policy into the agent's system prompt. Agents
  // without one get the policy as the first prompt of a fresh session, which some treat as an
  // injected instruction.
  readonly argsWithSystemPrompt?: (policy: string) => ReadonlyArray<string>;
  // The agent keeps one MCP client per server name for the whole process, so a later session's
  // credentials would replace an earlier one's. Such an agent gets a private process per chat while
  // Glade's MCP server is attached, so no chat can act with another chat's identity.
  readonly sharesMcpServersAcrossSessions?: boolean;
  // The tool a wrapper call actually ran, read from the call's output, for agents that run tools
  // from inside a code tool. A call that ran exactly one tool is shown as that tool.
  readonly innerToolCall?: AcpInnerToolCall;
  // A turn's token usage for agents that report it outside the prompt response's `usage` field.
  readonly promptUsage?: AcpPromptUsage;
  // The agent's native command that compacts its context, run as a turn when Glade compacts.
  readonly compactCommand?: string;
  // Native slash commands for features outside Glade's scope, hidden from the composer.
  readonly hiddenCommands: ReadonlySet<string>;
  // The MCP servers the agent keeps in its own user configuration.
  readonly userMcpServers?: ProviderUserMcpServers;
}
