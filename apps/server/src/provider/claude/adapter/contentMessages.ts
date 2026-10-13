import { Effect } from "effect";
import { makeClaudeReasoningBlocks } from "./reasoningBlocks";
import { makeClaudeAssistantText } from "./assistantText";
import { EventId, RuntimeTaskId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeToolTracking } from "./toolTracking";
import { appendStreamedToolInput } from "./streamedToolInput";
import { makeClaudeWorkflowRuntime } from "./workflowRuntime";
import { makeClaudeContextUsage } from "./contextUsage";
import { ClaudeSessionContext, PROVIDER, ToolInFlight } from "./sessionTypes";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  asRuntimeItemId,
  nativeProviderRefs,
  asCanonicalTurnId,
  extractContentBlockText,
  extractTextContent,
} from "./messageContent";
import {
  summarizeToolRequest,
  toolLifecycleEventData,
  isClientSurfacedClaudeTool,
  isClaudeSubagentTool,
  toolResultBlocksFromUserMessage,
  toolResultStreamKind,
} from "./toolPresentation";
import {
  parseClaudeWorkflowLaunch,
  parseClaudeWorkflowLaunchFromText,
} from "../claudeWorkflowScript.ts";
import { claudeAssistantErrorMessage, hasPendingUserInterrupt } from "./streamErrors";

import { normalizeClaudeTokenUsage } from "../claudeTokenUsage.ts";

export function makeClaudeContentMessages(input: {
  readonly ensureAssistantTextBlock: ReturnType<
    typeof makeClaudeAssistantText
  >["ensureAssistantTextBlock"];
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly openInFlightTool: ReturnType<typeof makeClaudeToolTracking>["openInFlightTool"];
  readonly completeAssistantTextBlock: ReturnType<
    typeof makeClaudeAssistantText
  >["completeAssistantTextBlock"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
  readonly startWorkflowRuntimePoller: ReturnType<
    typeof makeClaudeWorkflowRuntime
  >["startWorkflowRuntimePoller"];
  readonly ensureSyntheticTurn: ReturnType<typeof makeClaudeToolTracking>["ensureSyntheticTurn"];

  readonly backfillAssistantTextBlocksFromSnapshot: ReturnType<
    typeof makeClaudeAssistantText
  >["backfillAssistantTextBlocksFromSnapshot"];
  readonly maybeEmitContextUsageWarning: ReturnType<
    typeof makeClaudeContextUsage
  >["maybeEmitContextUsageWarning"];
}) {
  const {
    ensureAssistantTextBlock,
    makeEventStamp,
    offerRuntimeEvent,
    openInFlightTool,
    completeAssistantTextBlock,
    updateResumeCursor,
    startWorkflowRuntimePoller,
    ensureSyntheticTurn,

    backfillAssistantTextBlocksFromSnapshot,
    maybeEmitContextUsageWarning,
  } = input;
  const { handleReasoningStream, backfillReasoning } = makeClaudeReasoningBlocks({
    makeEventStamp,
    offerRuntimeEvent,
  });
  const handleStreamEvent = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "stream_event") {
        return;
      }

      const { event } = message;
      if (event.type === "message_start") yield* ensureSyntheticTurn(context);
      yield* handleReasoningStream(context, message);
      if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") return;

      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta" && context.turnState) {
          const deltaText = event.delta.text;
          if (deltaText.length === 0) return;
          const streamKind = "assistant_text" as const;
          const assistantBlockEntry = yield* ensureAssistantTextBlock(context, event.index);
          if (assistantBlockEntry?.block) assistantBlockEntry.block.emittedTextDelta = true;
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "content.delta",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            turnId: context.turnState.turnId,
            ...(assistantBlockEntry?.block
              ? { itemId: asRuntimeItemId(assistantBlockEntry.block.itemId) }
              : {}),
            payload: {
              streamKind,
              delta: deltaText,
            },
            providerRefs: nativeProviderRefs(context),
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_delta",
              payload: {},
            },
          });
          return;
        }

        if (event.delta.type === "input_json_delta") {
          const tool = context.inFlightTools.get(event.index);
          if (!tool || typeof event.delta.partial_json !== "string") {
            return;
          }

          const { input: partialInput, parsed: parsedInput } = appendStreamedToolInput(
            tool.partialInput,
            event.delta.partial_json,
          );
          const detail = parsedInput
            ? summarizeToolRequest(tool.toolName, parsedInput.value, parsedInput.serialized)
            : tool.detail;
          let nextTool: ToolInFlight = {
            ...tool,
            partialInput,
            ...(parsedInput ? { input: parsedInput.value } : {}),
            ...(detail ? { detail } : {}),
          };

          const nextFingerprint =
            parsedInput && Object.keys(parsedInput.value).length > 0
              ? parsedInput.serialized
              : undefined;
          context.inFlightTools.set(event.index, nextTool);

          if (
            !parsedInput ||
            !nextFingerprint ||
            tool.lastEmittedInputFingerprint === nextFingerprint
          ) {
            return;
          }

          nextTool = {
            ...nextTool,
            lastEmittedInputFingerprint: nextFingerprint,
          };
          context.inFlightTools.set(event.index, nextTool);

          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "item.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(nextTool.itemId),
            payload: {
              itemType: nextTool.itemType,
              status: "inProgress",
              title: nextTool.title,
              ...(nextTool.detail ? { detail: nextTool.detail } : {}),
              data: toolLifecycleEventData(context, nextTool),
            },
            providerRefs: nativeProviderRefs(context, { providerItemId: nextTool.itemId }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_delta/input_json_delta",
              payload: {},
            },
          });
        }
        return;
      }

      if (event.type === "content_block_start") {
        const { index, content_block: block } = event;
        if (block.type === "text") {
          yield* ensureAssistantTextBlock(context, index, {
            fallbackText: extractContentBlockText(block),
          });
          return;
        }
        if (
          block.type !== "tool_use" &&
          block.type !== "server_tool_use" &&
          block.type !== "mcp_tool_use"
        ) {
          return;
        }
        const toolName = block.name;

        if (isClientSurfacedClaudeTool(toolName)) {
          return;
        }
        yield* openInFlightTool(context, {
          blockIndex: index,
          toolName,
          itemId: block.id,
          toolInput:
            typeof block.input === "object" && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {},
          rawMethod: "claude/stream_event/content_block_start",
          rawPayload: message,
        });
        return;
      }

      if (event.type === "content_block_stop") {
        const { index } = event;
        const assistantBlock = context.turnState?.assistantTextBlocks.get(index);
        if (assistantBlock) {
          assistantBlock.streamClosed = true;
          yield* completeAssistantTextBlock(context, assistantBlock, {
            rawMethod: "claude/stream_event/content_block_stop",
            rawPayload: message,
          });
          return;
        }
        const tool = context.inFlightTools.get(index);
        if (!tool) {
          return;
        }
      }
    });

  const handleUserMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "user") {
        return;
      }

      const content = message.message.content;
      const prompt = context.subagentRefs
        ? typeof content === "string"
          ? extractTextContent(content)
          : content.map(extractContentBlockText).filter(Boolean).join("\n")
        : "";
      if (prompt.trim() && context.turnState) {
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          ...stamp,
          type: "item.completed",
          provider: PROVIDER,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          ...(message.uuid ? { itemId: asRuntimeItemId(message.uuid) } : {}),
          payload: { itemType: "user_message", status: "completed", detail: prompt },
          providerRefs: nativeProviderRefs(context),
        });
      }
      for (const toolResult of toolResultBlocksFromUserMessage(message)) {
        const toolEntry = Array.from(context.inFlightTools.entries()).find(
          ([, tool]) => tool.itemId === toolResult.toolUseId,
        );
        if (!toolEntry) {
          continue;
        }

        const [index, tool] = toolEntry;
        // An interrupted foreground subagent's error result arrives before the CLI reports the task
        // killed, so a pending stop of the parent turn already means the subagent was stopped.
        const subagentStopped =
          isClaudeSubagentTool(tool.toolName) &&
          (context.settledSubagentToolUseIds.get(tool.itemId) === "stopped" ||
            (toolResult.isError && hasPendingUserInterrupt(context)));
        const itemStatus = subagentStopped
          ? "declined"
          : toolResult.isError
            ? "failed"
            : "completed";
        const stoppedState = subagentStopped
          ? { agentStates: { [tool.itemId]: { status: "stopped" } } }
          : {};
        // The completion right below carries the result; repeating it on this update would store
        // the full output twice.
        const updatedToolData = toolLifecycleEventData(context, tool, stoppedState);
        const toolData = toolLifecycleEventData(context, tool, {
          result: toolResult.block,
          ...stoppedState,
        });

        const updatedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "item.updated",
          eventId: updatedStamp.eventId,
          provider: PROVIDER,
          createdAt: updatedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: subagentStopped ? "declined" : toolResult.isError ? "failed" : "inProgress",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: updatedToolData,
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });

        const streamKind = toolResultStreamKind(tool.itemType);
        if (streamKind && toolResult.text.length > 0 && context.turnState) {
          const deltaStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "content.delta",
            eventId: deltaStamp.eventId,
            provider: PROVIDER,
            createdAt: deltaStamp.createdAt,
            threadId: context.session.threadId,
            turnId: context.turnState.turnId,
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              streamKind,
              delta: toolResult.text,
            },
            providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/user",
              payload: {},
            },
          });
        }

        const workflowLaunch =
          tool.toolName === "Workflow"
            ? (parseClaudeWorkflowLaunch(toolResult.structuredResult) ??
              (toolResult.text.length > 0
                ? parseClaudeWorkflowLaunchFromText(toolResult.text)
                : undefined))
            : undefined;
        const workflowLaunchTaskId =
          workflowLaunch?.taskId ??
          (context.liveWorkflowTaskIds.size === 1
            ? Array.from(context.liveWorkflowTaskIds)[0]
            : undefined);
        if (workflowLaunch && workflowLaunchTaskId) {
          const launchStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent(context, {
            type: "task.updated",
            eventId: launchStamp.eventId,
            provider: PROVIDER,
            createdAt: launchStamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            payload: {
              taskId: RuntimeTaskId.makeUnsafe(workflowLaunchTaskId),
              ...(workflowLaunch.runId ? { workflowRunId: workflowLaunch.runId } : {}),
              ...(workflowLaunch.scriptPath
                ? { workflowScriptPath: workflowLaunch.scriptPath }
                : {}),
            },
            providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/user",
              payload: message,
            },
          });
          if (workflowLaunch.transcriptDir) {
            startWorkflowRuntimePoller(context, workflowLaunchTaskId, workflowLaunch.transcriptDir);
          }
        }

        const completedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "item.completed",
          eventId: completedStamp.eventId,
          provider: PROVIDER,
          createdAt: completedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: itemStatus,
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            data: toolData,
          },
          providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });

        if (tool.itemType === "file_change" && context.turnState) {
          context.turnState = {
            ...context.turnState,
            sawFileChange: true,
          };
        }
        context.inFlightTools.delete(index);
      }
    });

  const handleAssistantMessage = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "assistant") {
        return;
      }

      yield* ensureSyntheticTurn(context);
      if (message.error && context.turnState) {
        context.turnState = {
          ...context.turnState,
          assistantError: {
            code: message.error,
            message: claudeAssistantErrorMessage(message.error),
          },
        };
      }
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const toolUse = block as {
            type?: unknown;
            id?: unknown;
            name?: unknown;
            input?: unknown;
          };
          const isToolUseBlock =
            toolUse.type === "tool_use" ||
            toolUse.type === "server_tool_use" ||
            toolUse.type === "mcp_tool_use";
          if (
            isToolUseBlock &&
            context.subagentRefs !== undefined &&
            typeof toolUse.id === "string" &&
            typeof toolUse.name === "string" &&
            !isClientSurfacedClaudeTool(toolUse.name)
          ) {
            const toolUseId = toolUse.id;
            const alreadyOpen = Array.from(context.inFlightTools.values()).some(
              (tool) => tool.itemId === toolUseId,
            );
            if (!alreadyOpen) {
              let syntheticIndex = -1;
              for (const key of context.inFlightTools.keys()) {
                if (key <= syntheticIndex) {
                  syntheticIndex = key - 1;
                }
              }
              yield* openInFlightTool(context, {
                blockIndex: syntheticIndex,
                toolName: toolUse.name,
                itemId: toolUseId,
                toolInput:
                  typeof toolUse.input === "object" && toolUse.input !== null
                    ? (toolUse.input as Record<string, unknown>)
                    : {},
                rawMethod: "claude/assistant",
                rawPayload: message,
              });
            }
          }
        }
      }

      if (context.turnState) {
        yield* backfillReasoning(context, message);
        yield* backfillAssistantTextBlocksFromSnapshot(context, message);
      }

      const perCallUsage = (message.message as { usage?: unknown } | undefined)?.usage;
      if (perCallUsage) {
        const messageId = message.message.id ?? message.request_id ?? message.uuid;
        const normalizedPerCallUsage = normalizeClaudeTokenUsage(
          perCallUsage as Record<string, unknown>,
          context.lastKnownContextWindow,
        );
        let addedTokens = 0;
        if (normalizedPerCallUsage) {
          addedTokens = context.requestUsage.add(
            messageId,
            normalizedPerCallUsage.totalProcessedTokens ?? normalizedPerCallUsage.usedTokens,
          );
          context.processedTokenTotal += addedTokens;
        }
        if (context.tokenUsageState === "skip-compaction-call") {
          context.compactionMessageId = messageId;
          context.tokenUsageState = "awaiting-fresh-assistant";
        } else if (context.compactionMessageId !== messageId) {
          yield* maybeEmitContextUsageWarning(context, perCallUsage as Record<string, unknown>);
          context.tokenUsageState = "current";
        }
      }

      context.lastAssistantUuid = message.uuid;
      yield* updateResumeCursor(context);
    });
  return { handleStreamEvent, handleUserMessage, handleAssistantMessage };
}
