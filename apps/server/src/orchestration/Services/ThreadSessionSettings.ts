import { ServiceMap } from "effect";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export interface ThreadSessionSettingsShape {
  readonly getModelSelection: (threadId: ThreadId) => ModelSelection | undefined;
  readonly hasModelSelection: (threadId: ThreadId) => boolean;
  readonly setModelSelection: (threadId: ThreadId, selection: ModelSelection) => void;
  readonly getProviderOptions: (threadId: ThreadId) => ProviderStartOptions | undefined;
  readonly setProviderOptions: (threadId: ThreadId, options: ProviderStartOptions) => void;
  readonly markEditResendStart: (threadId: ThreadId, messageId: string) => void;
  readonly clearEditResendStart: (threadId: ThreadId, messageId: string) => void;
  readonly clearEditResendStartsForThread: (threadId: ThreadId) => void;
  // Whether the running provider session was started with the computer tools listed. Providers
  // read tools/list once per session, so a mismatch with Settings restarts it at the next check.
  readonly computerToolsListed: (threadId: ThreadId) => boolean;
  readonly setComputerToolsListed: (threadId: ThreadId, listed: boolean) => void;
  readonly clearThread: (threadId: ThreadId) => void;
}

export class ThreadSessionSettings extends ServiceMap.Service<
  ThreadSessionSettings,
  ThreadSessionSettingsShape
>()("glade/orchestration/Services/ThreadSessionSettings") {}
