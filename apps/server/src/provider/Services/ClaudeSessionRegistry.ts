import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, ServiceMap } from "effect";
import type { ClaudeSessionContext } from "../claude/adapter/sessionTypes.ts";

export interface ClaudeSessionRegistryShape {
  readonly get: (threadId: ThreadId) => ClaudeSessionContext | undefined;
  readonly register: (threadId: ThreadId, context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly removeIfCurrent: (
    threadId: ThreadId,
    context: ClaudeSessionContext,
  ) => Effect.Effect<void>;
  readonly isCurrent: (threadId: ThreadId, context: ClaudeSessionContext) => boolean;
  readonly list: () => ReadonlyArray<ClaudeSessionContext>;
}

export class ClaudeSessionRegistry extends ServiceMap.Service<
  ClaudeSessionRegistry,
  ClaudeSessionRegistryShape
>()("glade/provider/Services/ClaudeSessionRegistry") {}
