import {
  OrchestrationMessage,
  type OrchestrationMessageTextSegment,
} from "@glade/contracts/orchestration/threadEntities";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { ThreadAsyncUserInputAnsweredPayload } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import { MessageSentPayloadSchema } from "../Schemas.ts";
import { resolveStableMessageTurnId } from "../messageTurnId.ts";
import {
  ProjectionEffect,
  decodeForEvent,
  updateThread,
  MAX_THREAD_MESSAGES,
} from "./projectionState";

function findMessageIndexFromEnd(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.id === messageId) {
      return index;
    }
  }
  return -1;
}

function deriveNextMessageTextSegments(
  previous: ReadonlyArray<OrchestrationMessageTextSegment> | undefined,
  input: {
    readonly text: string;
    readonly streaming: boolean;
    readonly segmentStartedAt: string | undefined;
    readonly sequence: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): ReadonlyArray<OrchestrationMessageTextSegment> | undefined {
  if (input.streaming) {
    if (input.segmentStartedAt) {
      return [
        ...(previous ?? []),
        {
          sequence: input.sequence,
          startedAt: input.segmentStartedAt,
          endedAt: input.updatedAt,
          text: input.text,
        },
      ];
    }
    if (previous && previous.length > 0) {
      const tail = previous[previous.length - 1]!;
      return [
        ...previous.slice(0, -1),
        { ...tail, text: `${tail.text}${input.text}`, endedAt: input.updatedAt },
      ];
    }
    return [
      {
        sequence: input.sequence,
        startedAt: input.createdAt,
        endedAt: input.updatedAt,
        text: input.text,
      },
    ];
  }

  if (previous && previous.length > 1) {
    const collatedSegmentText = previous.map((segment) => segment.text).join("");
    if (collatedSegmentText === input.text || input.text.length === 0) {
      const tail = previous[previous.length - 1]!;
      return [...previous.slice(0, -1), { ...tail, endedAt: input.updatedAt }];
    }
  }
  return undefined;
}

export function projectMessageEvent(
  nextBase: OrchestrationReadModel,
  event: Extract<
    OrchestrationEvent,
    {
      type: "thread.async-user-input-answered" | "thread.message-sent";
    }
  >,
  historyLimit = MAX_THREAD_MESSAGES,
): ProjectionEffect {
  switch (event.type) {
    case "thread.async-user-input-answered":
      return decodeForEvent(
        ThreadAsyncUserInputAnsweredPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) return nextBase;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              messages: thread.messages.map((message) =>
                message.id === payload.messageId && message.asyncUserInput
                  ? {
                      ...message,
                      asyncUserInput: {
                        ...message.asyncUserInput,
                        response: payload.response,
                        responseSequence: event.sequence,
                      },
                    }
                  : message,
              ),
            }),
          };
        }),
      );
    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.asyncUserInput ? { asyncUserInput: payload.asyncUserInput } : {}),
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            ...(payload.skills !== undefined ? { skills: payload.skills } : {}),
            ...(payload.mentions !== undefined ? { mentions: payload.mentions } : {}),
            ...(payload.dispatchMode !== undefined ? { dispatchMode: payload.dispatchMode } : {}),
            ...(payload.dispatchOrigin !== undefined
              ? { dispatchOrigin: payload.dispatchOrigin }
              : {}),
            ...(payload.startsNewTurn !== undefined
              ? { startsNewTurn: payload.startsNewTurn }
              : {}),
            ...(payload.providerMessageId ? { providerMessageId: payload.providerMessageId } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            source: payload.source,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        // Hot path: one streamed delta must not cost a full copy-and-rebuild of the transcript. Update the
        // one affected slot in a single shallow copy and only re-cap when the transcript actually grew past
        // the limit.
        const existingIndex = findMessageIndexFromEnd(thread.messages, message.id);
        let cappedMessages: ReadonlyArray<OrchestrationMessage>;
        if (existingIndex >= 0) {
          const entry = thread.messages[existingIndex]!;
          const resolvedText = message.streaming
            ? `${entry.text}${message.text}`
            : message.text.length > 0
              ? message.text
              : entry.text;
          const nextSegments =
            message.role === "assistant"
              ? deriveNextMessageTextSegments(entry.textSegments, {
                  text: message.streaming ? message.text : resolvedText,
                  streaming: message.streaming,
                  segmentStartedAt: payload.segmentStartedAt,
                  sequence: payload.segmentSequence ?? event.sequence,
                  createdAt: payload.createdAt,
                  updatedAt: payload.updatedAt,
                })
              : undefined;
          const nextMessages = thread.messages.slice();
          const entryWithoutTextSegments = { ...entry };
          delete entryWithoutTextSegments.textSegments;
          nextMessages[existingIndex] = {
            ...entryWithoutTextSegments,
            ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
            ...(message.asyncUserInput ? { asyncUserInput: message.asyncUserInput } : {}),
            text: resolvedText,
            ...(nextSegments !== undefined ? { textSegments: nextSegments } : {}),
            streaming: message.streaming,
            source: message.source,
            updatedAt: message.updatedAt,
            turnId: resolveStableMessageTurnId({
              existingTurnId: entry.turnId,
              incomingTurnId: message.turnId,
            }),
            ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
            ...(message.skills !== undefined ? { skills: message.skills } : {}),
            ...(message.mentions !== undefined ? { mentions: message.mentions } : {}),
            ...(message.dispatchMode !== undefined
              ? { dispatchMode: message.dispatchMode }
              : entry.dispatchMode !== undefined
                ? { dispatchMode: entry.dispatchMode }
                : {}),
            ...(message.dispatchOrigin !== undefined
              ? { dispatchOrigin: message.dispatchOrigin }
              : entry.dispatchOrigin !== undefined
                ? { dispatchOrigin: entry.dispatchOrigin }
                : {}),
            ...(message.startsNewTurn !== undefined
              ? { startsNewTurn: message.startsNewTurn }
              : entry.startsNewTurn !== undefined
                ? { startsNewTurn: entry.startsNewTurn }
                : {}),
          };
          cappedMessages = nextMessages;
        } else {
          const nextSegments =
            message.role === "assistant"
              ? deriveNextMessageTextSegments(undefined, {
                  text: message.text,
                  streaming: message.streaming,
                  segmentStartedAt: payload.segmentStartedAt,
                  sequence: payload.segmentSequence ?? event.sequence,
                  createdAt: payload.createdAt,
                  updatedAt: payload.updatedAt,
                })
              : undefined;
          cappedMessages =
            thread.messages.length >= historyLimit
              ? [
                  ...thread.messages.slice(thread.messages.length - historyLimit + 1),
                  {
                    ...message,
                    ...(nextSegments !== undefined ? { textSegments: nextSegments } : {}),
                  },
                ]
              : [
                  ...thread.messages,
                  {
                    ...message,
                    ...(nextSegments !== undefined ? { textSegments: nextSegments } : {}),
                  },
                ];
        }

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });
  }
}
