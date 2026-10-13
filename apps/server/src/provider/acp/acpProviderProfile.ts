import type { ClientSideConnection, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

// Answers an agent's own JSON-RPC methods (for example `x.ai/*` or `cursor/*`). Returning
// undefined declines the method with an error, so the agent never waits on a request Glade does
// not render.
interface AcpExtensionHandlers {
  readonly request?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | undefined> | undefined;
}

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
  // Native slash commands for features outside Glade's scope, hidden from the composer.
  readonly hiddenCommands: ReadonlySet<string>;
  readonly extensions?: AcpExtensionHandlers;
}
