import { Effect } from "effect";
import { makeClaudeAssistantText } from "./assistantText";
import { EventId, RuntimeTaskId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { makeClaudeTaskPresentation } from "./taskPresentation";
import { makeClaudeToolTracking } from "./toolTracking";
import { makeClaudeWorkflowRuntime } from "./workflowRuntime";
import { makeClaudeContextUsage } from "./contextUsage";
import {
  ClaudeSessionContext,
  AssistantTextBlockState,
  PROVIDER,
  ToolInFlight,
} from "./sessionTypes";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  streamKindFromDeltaType,
  asRuntimeItemId,
  nativeProviderRefs,
  asCanonicalTurnId,
  extractContentBlockText,
  extractExitPlanModePlan,
  extractTextContent,
} from "./messageContent";
import {
  tryParseCompleteJsonRecord,
  summarizeToolRequest,
  toolLifecycleEventData,
  isClientSurfacedClaudeTool,
  toolResultBlocksFromUserMessage,
  toolResultStreamKind,
} from "./toolPresentation";
import { stripDiagnosticImages } from "../../core/stripDiagnosticImages.ts";
import { applyClaudeTaskToolResult } from "../claudeTaskTracker.ts";
import {
  parseClaudeWorkflowLaunch,
  parseClaudeWorkflowLaunchFromText,
} from "../claudeWorkflowScript.ts";
import { claudeAssistantErrorMessage } from "./streamErrors";
import { extractProposedPlanMarkdown } from "../../core/planMode.ts";
import { normalizeClaudeTokenUsage } from "../claudeTokenUsage.ts";

export function makeClaudeContentMessages(input: {
  readonly ensureAssistantTextBlock: ReturnType<
    typeof makeClaudeAssistantText
  >["ensureAssistantTextBlock"];
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
  readonly emitTodoTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTodoTasksUpdated"];
  readonly openInFlightTool: ReturnType<typeof makeClaudeToolTracking>["openInFlightTool"];
  readonly completeAssistantTextBlock: ReturnType<
    typeof makeClaudeAssistantText
  >["completeAssistantTextBlock"];
  readonly updateResumeCursor: ClaudeRuntimeEventsShape["updateResumeCursor"];
  readonly emitTrackedTasksUpdated: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitTrackedTasksUpdated"];
  readonly startWorkflowRuntimePoller: ReturnType<
    typeof makeClaudeWorkflowRuntime
  >["startWorkflowRuntimePoller"];
  readonly ensureSyntheticTurn: ReturnType<typeof makeClaudeToolTracking>["ensureSyntheticTurn"];
  readonly emitProposedPlanCompleted: ReturnType<
    typeof makeClaudeTaskPresentation
  >["emitProposedPlanCompleted"];
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
    emitTodoTasksUpdated,
    openInFlightTool,
    completeAssistantTextBlock,
    updateResumeCursor,
    emitTrackedTasksUpdated,
    startWorkflowRuntimePoller,
    ensureSyntheticTurn,
    emitProposedPlanCompleted,
    backfillAssistantTextBlocksFromSnapshot,
    maybeEmitContextUsageWarning,
  } = input;
  const handleStreamEvent = (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (message.type !== "stream_event") {
        return;
      }

      const { event } = message;

      if (event.type === "content_block_delta") {
        if (
          (event.delta.type === "text_delta" || event.delta.type === "thinking_delta") &&
          context.turnState
        ) {
          const deltaText =
            event.delta.type === "text_delta"
              ? event.delta.text
              : typeof event.delta.thinking === "string"
                ? event.delta.thinking
                : "";
          if (deltaText.length === 0) {
            return;
          }
          const streamKind = streamKindFromDeltaType(event.delta.type);
          const assistantBlockEntry =
            event.delta.type === "text_delta"
              ? yield* ensureAssistantTextBlock(context, event.index)
              : context.turnState.assistantTextBlocks.get(event.index)
                ? {
                    blockIndex: event.index,
                    block: context.turnState.assistantTextBlocks.get(
                      event.index,
                    ) as AssistantTextBlockState,
                  }
                : undefined;
          if (assistantBlockEntry?.block && event.delta.type === "text_delta") {
            assistantBlockEntry.block.emittedTextDelta = true;
          }
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

          const partialInputJson = tool.partialInputJson + event.delta.partial_json;
          const parsedInput = tryParseCompleteJsonRecord(partialInputJson);
          const detail = parsedInput
            ? summarizeToolRequest(tool.toolName, parsedInput.value, parsedInput.serialized)
            : tool.detail;
          let nextTool: ToolInFlight = {
            ...tool,
            partialInputJson,
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
              data: toolLifecycleEventData(nextTool),
            },
            providerRefs: nativeProviderRefs(context, { providerItemId: nextTool.itemId }),
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_delta/input_json_delta",
              payload: {},
            },
          });
          if (nextTool.toolName === "TodoWrite") {
            yield* emitTodoTasksUpdated(context, {
              toolInput: nextTool.input,
              toolUseId: nextTool.itemId,
              rawMethod: "claude/stream_event/content_block_delta/input_json_delta",
              rawPayload: message,
            });
          }
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

      if (context.turnState) {
        context.turnState.items.push(stripDiagnosticImages(message.message));
      }

      for (const toolResult of toolResultBlocksFromUserMessage(message)) {
        const toolEntry = Array.from(context.inFlightTools.entries()).find(
          ([, tool]) => tool.itemId === toolResult.toolUseId,
        );
        if (!toolEntry) {
          continue;
        }

        const [index, tool] = toolEntry;
        const itemStatus = toolResult.isError ? "failed" : "completed";

        const settledStatus =
          tool.toolName === "Task" || tool.toolName === "Agent"
            ? context.settledSubagentToolUseIds.get(tool.itemId)
            : undefined;
        const toolData = toolLifecycleEventData(tool, {
          result: toolResult.block,
          ...(settledStatus === "stopped"
            ? { agentStates: { [tool.itemId]: { status: "stopped" } } }
            : {}),
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
            status: toolResult.isError ? "failed" : "inProgress",
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

        if (
          applyClaudeTaskToolResult(
            context.trackedTasks,
            tool,
            toolResult.block,
            toolResult.structuredResult,
            toolResult.isError,
          )
        ) {
          yield* updateResumeCursor(context);
          yield* emitTrackedTasksUpdated(context, {
            toolUseId: tool.itemId,
            rawPayload: message,
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
          if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") {
            continue;
          }
          const planMarkdown = extractExitPlanModePlan(toolUse.input);
          if (!planMarkdown) {
            continue;
          }
          yield* emitProposedPlanCompleted(context, {
            planMarkdown,
            toolUseId: typeof toolUse.id === "string" ? toolUse.id : undefined,
            rawSource: "claude.sdk.message",
            rawMethod: "claude/assistant",
            rawPayload: message,
          });
        }

        const taggedPlanMarkdown =
          context.turnState?.interactionMode === "plan"
            ? extractProposedPlanMarkdown(extractTextContent(content))
            : undefined;
        if (taggedPlanMarkdown) {
          yield* emitProposedPlanCompleted(context, {
            planMarkdown: taggedPlanMarkdown,
            rawSource: "claude.sdk.message",
            rawMethod: "claude/assistant/proposed-plan-block",
            rawPayload: message,
          });
        }
      }

      if (context.turnState) {
        context.turnState.items.push(stripDiagnosticImages(message.message));
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
