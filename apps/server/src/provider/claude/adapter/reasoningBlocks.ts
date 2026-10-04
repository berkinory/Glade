import { Effect } from "effect";
import { EventId } from "@glade/contracts/core/baseSchemas";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents";
import type { ClaudeSessionContext, ClaudeReasoningBlock } from "./sessionTypes";
import { PROVIDER } from "./sessionTypes";
import { asRuntimeItemId, nativeProviderRefs } from "./messageContent";

const MAX_REASONING_CHARS = 2_000;

export function makeClaudeReasoningBlocks(input: {
  makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
}) {
  const emit = (
    context: ClaudeSessionContext,
    block: ClaudeReasoningBlock,
    status: "completed" | "failed" | "interrupted",
  ) =>
    Effect.gen(function* () {
      if (!context.turnState || !block.text.trim()) return;
      const stamp = yield* input.makeEventStamp();
      yield* input.offerRuntimeEvent(context, {
        ...stamp,
        type: "item.completed",
        provider: PROVIDER,
        threadId: context.session.threadId,
        turnId: context.turnState.turnId,
        itemId: asRuntimeItemId(block.itemId),
        payload: {
          itemType: "reasoning",
          status: status === "interrupted" ? "declined" : status,
          title: "Thinking",
          detail: block.text,
        },
        providerRefs: nativeProviderRefs(context),
      });
    });

  const update = (
    context: ClaudeSessionContext,
    identity: { messageId: string; index: number; key?: string },
    text: string,
    complete: boolean,
    snapshot = false,
  ) =>
    Effect.gen(function* () {
      const turn = context.turnState;
      if (!turn) return;
      turn.reasoningBlocks ??= new Map();
      const key = identity.key ?? `${identity.messageId}:${identity.index}`;
      let block = turn.reasoningBlocks.get(key);
      if (block?.completed && !snapshot) return;
      if (!block && !text.trim()) return;
      if (!block) {
        block = {
          itemId: `claude-thinking:${turn.turnId}:${key}`,
          messageId: identity.messageId,
          index: identity.index,
          text: "",
          completed: false,
          snapshotReceived: false,
        };
        turn.reasoningBlocks.set(key, block);
      }
      const next = snapshot
        ? text.slice(0, MAX_REASONING_CHARS)
        : (block.text + text).slice(0, MAX_REASONING_CHARS);
      const delta = next.startsWith(block.text) ? next.slice(block.text.length) : "";
      const changed = block.text !== next;
      block.text = next;
      if (snapshot) block.snapshotReceived = true;
      if (delta && !block.completed) {
        const stamp = yield* input.makeEventStamp();
        yield* input.offerRuntimeEvent(context, {
          ...stamp,
          type: "content.delta",
          provider: PROVIDER,
          threadId: context.session.threadId,
          turnId: turn.turnId,
          itemId: asRuntimeItemId(block.itemId),
          payload: { streamKind: "reasoning_text", delta },
          providerRefs: nativeProviderRefs(context),
        });
      }
      if (complete && (!block.completed || changed)) {
        block.completed = true;
        yield* emit(context, block, "completed");
      }
    });

  const handleReasoningStream = (context: ClaudeSessionContext, message: SDKMessage) =>
    Effect.gen(function* () {
      if (message.type !== "stream_event" || !context.turnState) return;
      const event = message.event;
      if (event.type === "message_start") {
        context.turnState.reasoningMessageId = event.message.id;
        return;
      }
      const messageId = context.turnState.reasoningMessageId;
      if (!messageId) return;
      if (event.type === "content_block_start" && event.content_block.type === "thinking") {
        yield* update(
          context,
          { messageId, index: event.index },
          event.content_block.thinking,
          false,
        );
      } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
        yield* update(context, { messageId, index: event.index }, event.delta.thinking, false);
      } else if (event.type === "content_block_stop") {
        yield* update(context, { messageId, index: event.index }, "", true);
      }
    });

  const backfillReasoning = (context: ClaudeSessionContext, message: SDKMessage) =>
    Effect.gen(function* () {
      if (message.type !== "assistant" || !context.turnState) return;
      const content = message.message.content;
      const messageId = message.message.id;
      for (const [index, value] of content.entries()) {
        if (value.type !== "thinking" || !value.thinking.trim()) continue;
        const text = value.thinking.slice(0, MAX_REASONING_CHARS);
        // The SDK also sends singleton snapshots, omitting their original stream index.
        const candidates = [...(context.turnState.reasoningBlocks?.entries() ?? [])].filter(
          ([, block]) => block.messageId === messageId,
        );
        const exact =
          candidates.find(([, block]) => !block.snapshotReceived && block.text === text) ??
          candidates.find(([, block]) => block.text === text);
        const pending = candidates.find(([, block]) => !block.snapshotReceived);
        const key =
          content.length > 1
            ? `${messageId}:${index}`
            : (exact?.[0] ?? pending?.[0] ?? `${messageId}:snapshot:${message.uuid}:${index}`);
        yield* update(context, { messageId, index, key }, text, true, true);
      }
    });

  const settleReasoning = (
    context: ClaudeSessionContext,
    status: "completed" | "failed" | "interrupted",
  ) =>
    Effect.gen(function* () {
      for (const block of context.turnState?.reasoningBlocks?.values() ?? []) {
        context.settledReasoningMessageIds ??= new Set();
        context.settledReasoningMessageIds.add(block.messageId);
        if (context.settledReasoningMessageIds.size > 256)
          context.settledReasoningMessageIds.delete(
            context.settledReasoningMessageIds.values().next().value!,
          );
        if (block.completed) continue;
        block.completed = true;
        yield* emit(context, block, status);
      }
    });
  return { handleReasoningStream, backfillReasoning, settleReasoning };
}
