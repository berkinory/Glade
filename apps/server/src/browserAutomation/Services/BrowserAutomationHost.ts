import type { BrowserToolName, ProviderKind, ThreadId } from "@glade/contracts";
import { ServiceMap, type Effect } from "effect";

import type { BrowserHostRpcError } from "../browserHostRpcClient.ts";

interface BrowserAutomationHostCall {
  readonly sessionKey: string;
  readonly provider: ProviderKind;
  readonly threadId: ThreadId;
  readonly name: BrowserToolName;
  readonly arguments: Record<string, unknown>;

  readonly workspaceRoot?: string;
  readonly timeoutMs: number;
}

export interface BrowserAutomationHostShape {
  readonly available: boolean;
  readonly execute: (
    input: BrowserAutomationHostCall,
  ) => Effect.Effect<unknown, BrowserHostRpcError>;
}

export class BrowserAutomationHost extends ServiceMap.Service<
  BrowserAutomationHost,
  BrowserAutomationHostShape
>()("glade/browserAutomation/Services/BrowserAutomationHost") {}
