import { ServiceMap } from "effect";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export interface ThreadSessionSettingsShape {
  readonly getModelSelection: (threadId: ThreadId) => ModelSelection | undefined;
  readonly hasModelSelection: (threadId: ThreadId) => boolean;
  readonly setModelSelection: (threadId: ThreadId, selection: ModelSelection) => void;
  readonly getProviderOptions: (threadId: ThreadId) => ProviderStartOptions | undefined;
  readonly setProviderOptions: (threadId: ThreadId, options: ProviderStartOptions) => void;
  readonly getComputerControl: (threadId: ThreadId) => boolean | undefined;
  readonly setComputerControl: (threadId: ThreadId, enabled: boolean) => void;
  readonly markEditResendStart: (threadId: ThreadId, messageId: string) => void;
  readonly clearEditResendStart: (threadId: ThreadId, messageId: string) => void;
  readonly clearEditResendStartsForThread: (threadId: ThreadId) => void;
  readonly clearThread: (threadId: ThreadId) => void;
}

export class ThreadSessionSettings extends ServiceMap.Service<
  ThreadSessionSettings,
  ThreadSessionSettingsShape
>()("glade/orchestration/Services/ThreadSessionSettings") {}
