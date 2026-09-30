import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, ServiceMap } from "effect";
import type { ClaudeSessionContext } from "../claude/adapter/sessionTypes.ts";
import type { ClaudeAdapterShape } from "./ClaudeAdapter.ts";
import type { ProviderAdapterError, ProviderAdapterValidationError } from "../core/Errors.ts";

export interface ClaudeStartPreflight {
  readonly claudeSdkEnv: NodeJS.ProcessEnv;
  readonly snapshotSupported: boolean;
}

export interface ClaudeSessionAccessShape {
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<ClaudeSessionContext, ProviderAdapterError>;
  readonly assertSessionReplaceable: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ProviderAdapterValidationError>;
  readonly resolveNativeCommandNames: (
    context: ClaudeSessionContext,
    text: string | undefined,
  ) => Effect.Effect<ReadonlySet<string> | undefined>;
  readonly resolveClaudeStartPreflight: (
    input: Parameters<ClaudeAdapterShape["startSession"]>[0],
  ) => Effect.Effect<ClaudeStartPreflight, ProviderAdapterValidationError>;
}

export class ClaudeSessionAccess extends ServiceMap.Service<
  ClaudeSessionAccess,
  ClaudeSessionAccessShape
>()("glade/provider/Services/ClaudeSessionAccess") {}
