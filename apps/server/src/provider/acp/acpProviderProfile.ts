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
  // Native slash commands for features outside Glade's scope, hidden from the composer.
  readonly hiddenCommands: ReadonlySet<string>;
  readonly extensions?: AcpExtensionHandlers;
}
