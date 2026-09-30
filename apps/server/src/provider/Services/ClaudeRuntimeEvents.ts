import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Effect, ServiceMap, Stream } from "effect";
import type { ClaudeSessionContext } from "../claude/adapter/sessionTypes.ts";
import type { ProviderAdapterValidationError } from "../core/Errors.ts";

export interface ClaudeRuntimeEventsShape {
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<{
    eventId: import("@glade/contracts/core/baseSchemas").EventId;
    createdAt: string;
  }>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
  readonly offerRuntimeEvent: (
    context: ClaudeSessionContext,
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<void>;
  readonly emitRuntimeWarning: (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ) => Effect.Effect<void>;
  readonly updateResumeCursor: (
    context: ClaudeSessionContext,
    updatedAt?: string,
  ) => Effect.Effect<void>;
  readonly emitRuntimeError: (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ) => Effect.Effect<void>;
  readonly emitCompactionProgress: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly warnUnhandledSdkKind: (
    context: ClaudeSessionContext,
    kind: string,
    message: string,
    detail: unknown,
  ) => Effect.Effect<void>;
  readonly logNativeSdkMessage: (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) => Effect.Effect<void>;
  readonly ensureThreadId: (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) => Effect.Effect<void>;
  readonly emitClaudeCacheObservation: (context: ClaudeSessionContext) => Effect.Effect<void>;
  readonly snapshotThread: (context: ClaudeSessionContext) => Effect.Effect<
    {
      threadId: ThreadId;
      turns: ReadonlyArray<{ id: TurnId; items: ReadonlyArray<unknown> }>;
    },
    ProviderAdapterValidationError
  >;
}

export class ClaudeRuntimeEvents extends ServiceMap.Service<
  ClaudeRuntimeEvents,
  ClaudeRuntimeEventsShape
>()("glade/provider/Services/ClaudeRuntimeEvents") {}
