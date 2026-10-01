import { Effect, Layer, Ref } from "effect";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ClaudeSessionRegistry,
  type ClaudeSessionRegistryShape,
} from "../Services/ClaudeSessionRegistry.ts";
import type { ClaudeSessionContext } from "../claude/adapter/sessionTypes.ts";

export const ClaudeSessionRegistryLive = Layer.effect(
  ClaudeSessionRegistry,
  Ref.make(new Map<ThreadId, ClaudeSessionContext>()).pipe(
    Effect.map((sessions) => {
      return {
        get: (threadId) => Ref.getUnsafe(sessions).get(threadId),
        register: (threadId, context) =>
          Ref.update(sessions, (current) => new Map(current).set(threadId, context)),
        removeIfCurrent: (threadId, context) =>
          Ref.update(sessions, (current) => {
            if (current.get(threadId) !== context) return current;
            const next = new Map(current);
            next.delete(threadId);
            return next;
          }),
        isCurrent: (threadId, context) => Ref.getUnsafe(sessions).get(threadId) === context,
        list: () => [...Ref.getUnsafe(sessions).values()],
      } satisfies ClaudeSessionRegistryShape;
    }),
  ),
);
